import { createTask, validateTask } from "../../core/task.js";
import { ValidationError } from '../../core/errors.js';
import { validateResult } from '../../core/result.js';

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function hydrateTask(row, database) {
  if (!row) return null;
  const images = database.prepare("SELECT file_path FROM task_images WHERE task_id = ? ORDER BY sort_order, id")
    .all(row.id).map((item) => item.file_path);
  const jobs = database.prepare("SELECT * FROM publish_jobs WHERE task_id = ? ORDER BY id").all(row.id);
  const weiboRow = database.prepare("SELECT * FROM weibo_results WHERE task_id = ?").get(row.id) || null;
  const weibo = weiboRow ? {
    ...weiboRow,
    raw: parseJson(weiboRow.raw_json, {}),
    evidence: parseJson(weiboRow.evidence_json, {})
  } : null;
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    resourceUrl: row.resource_url,
    selectedPlatforms: parseJson(row.selected_platforms, []),
    accountIds: parseJson(row.account_ids, {}),
    status: row.status,
    images,
    jobs,
    weibo,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class TaskRepository {
  constructor(database) {
    this.database = database;
  }

  create(input, options = {}) {
    const task = validateTask(createTask(input), options);
    for(const platform of task.selectedPlatforms) {
      const id=task.accountIds[platform];
      const account=id ? this.database.prepare('SELECT * FROM accounts WHERE id=?').get(id) : null;
      if(!account || account.platform!==platform || !account.enabled) throw new ValidationError(`${platform} 必须选择存在且启用的本平台账号`);
    }
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO tasks(id, title, content, resource_url, selected_platforms, account_ids, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(task.id, task.title, task.content, task.resourceUrl, JSON.stringify(task.selectedPlatforms), JSON.stringify(task.accountIds), task.status, now, now);

      const insertImage = this.database.prepare("INSERT INTO task_images(task_id, file_path, sort_order) VALUES (?, ?, ?)");
      task.images.forEach((filePath, index) => insertImage.run(task.id, filePath, index));

      const insertJob = this.database.prepare(`
        INSERT INTO publish_jobs(task_id, platform, account_id, status, created_at, updated_at, phase)
        VALUES (?, ?, ?, ?, ?, ?, 'prepare')
      `);
      task.selectedPlatforms.forEach((platform) => {
        insertJob.run(task.id, platform, task.accountIds[platform] || null, platform === "weibo" ? "pending" : "blocked", now, now);
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.get(task.id);
  }

  get(id) {
    return hydrateTask(this.database.prepare("SELECT * FROM tasks WHERE id = ?").get(id), this.database);
  }

  list({ limit = 200, status } = {}) {
    const rows = status
      ? this.database.prepare("SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(status, limit)
      : this.database.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?").all(limit);
    return rows.map((row) => hydrateTask(row, this.database));
  }

  setStatus(id, status) {
    this.database.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, new Date().toISOString(), id);
    return this.get(id);
  }

  updateJob(jobId, patch) {
    const allowed = new Set([
      "status", "attempt_count", "post_id", "post_url", "result_status", "started_at", "finished_at",
      "error_code", "error_message", "phase", "evidence", "retry_count"
    ]);
    const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
    if (!entries.length) return this.getJob(jobId);
    const sql = `UPDATE publish_jobs SET ${entries.map(([key]) => `${key} = ?`).join(", ")}, updated_at = ? WHERE id = ?`;
    this.database.prepare(sql).run(...entries.map(([, value]) => value), new Date().toISOString(), jobId);
    return this.getJob(jobId);
  }

  getJob(jobId) {
    return this.database.prepare("SELECT * FROM publish_jobs WHERE id = ?").get(jobId) || null;
  }

  getJobForTask(taskId, platform) {
    return this.database.prepare("SELECT * FROM publish_jobs WHERE task_id = ? AND platform = ?").get(taskId, platform) || null;
  }

  unlockDownstream(taskId) {
    this.database.prepare("UPDATE publish_jobs SET status = 'pending', updated_at = ? WHERE task_id = ? AND platform != 'weibo' AND status = 'blocked'")
      .run(new Date().toISOString(), taskId);
  }

  saveWeiboResult(taskId, result, accountId = "") {
    const now = new Date().toISOString();
    const raw = result.raw && typeof result.raw === 'object' ? result.raw : {
      id: result.id || result.weiboId || "",
      mid: result.mid || "",
      bid: result.bid || "",
      userId: result.userId || "",
      canonicalUrl: result.canonicalUrl || "",
      shareUrl: result.shareUrl || "",
      publishedAt: result.publishedAt || now,
      resolution: result.resolution || "",
      resultStatus: result.resultStatus || "published"
    };
    this.database.prepare(`
      INSERT INTO weibo_results(
        task_id, weibo_id, mid, bid, user_id, canonical_url, share_url, published_at,
        raw_json, updated_at, account_id, resolution, evidence_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        weibo_id = excluded.weibo_id, mid = excluded.mid, bid = excluded.bid, user_id = excluded.user_id,
        canonical_url = excluded.canonical_url, share_url = excluded.share_url,
        published_at = excluded.published_at, raw_json = excluded.raw_json, updated_at = excluded.updated_at,
        account_id = excluded.account_id, resolution = excluded.resolution, evidence_json = excluded.evidence_json
    `).run(
      taskId, result.id || result.weiboId || "", result.mid || "", result.bid || "", result.userId || "",
      result.canonicalUrl || "", result.shareUrl || "", result.publishedAt || now, JSON.stringify(raw), now,
      accountId || "", result.resolution || "", JSON.stringify(result.evidence || {})
    );
    return this.get(taskId).weibo;
  }

  recoverInterrupted() {
    const now = new Date().toISOString();
    const jobs = this.database.prepare("UPDATE publish_jobs SET status = 'interrupted', updated_at = ? WHERE status = 'running'").run(now);
    const tasks = this.database.prepare(`
      UPDATE tasks SET status = 'paused', updated_at = ?
      WHERE status IN ('publishing_weibo', 'resolving_weibo_url', 'distributing')
    `).run(now);
    return { jobs: Number(jobs.changes), tasks: Number(tasks.changes) };
  }

  continueTask(taskId) {
    const now = new Date().toISOString();
    const task = this.get(taskId);
    if (!task) return null;
    this.database.prepare("UPDATE publish_jobs SET status = 'pending', retry_count = 0, updated_at = ? WHERE task_id = ? AND status IN ('interrupted', 'paused', 'needs_action') AND phase='prepare'")
      .run(now, taskId);
    this.database.prepare("UPDATE publish_jobs SET status='needs_action', error_code='PUBLISH_UNCERTAIN', error_message='提交结果需要核对，禁止自动重发' WHERE task_id=? AND status='interrupted' AND phase!='prepare'").run(taskId);
    this.setStatus(taskId, "pending");
    return this.get(taskId);
  }

  retryFailed(taskId) {
    const now = new Date().toISOString();
    this.database.prepare("UPDATE publish_jobs SET status='pending', retry_count=0, error_code='', error_message='', updated_at=? WHERE task_id=? AND status='failed' AND phase='prepare'").run(now,taskId);
    this.setStatus(taskId, "pending");
    return this.get(taskId);
  }

  finishJob(job, result) {
    const validated=validateResult(job.platform,result);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.updateJob(job.id,{status:validated.resultStatus==='submitted'?'submitted':'success',phase:validated.resultStatus,
        post_id:String(validated.id || validated.postId || ''),post_url:validated.canonicalUrl || validated.postUrl || '',
        result_status:validated.resultStatus,finished_at:validated.publishedAt || new Date().toISOString(),
        error_code:'',error_message:'',evidence:JSON.stringify(validated.evidence || {})});
      if(job.platform==='weibo') {
        this.saveWeiboResult(job.task_id,validated,job.account_id || '');
        this.unlockDownstream(job.task_id);
      }
      this.database.exec('COMMIT');
    } catch(e) {this.database.exec('ROLLBACK');throw e;}
    return validated;
  }

  cancelTask(id) {
    if(this.get(id)?.jobs.some(j=>j.status==='running')) throw new ValidationError('任务正在执行，请先暂停并等待当前步骤结束');
    this.database.prepare("UPDATE publish_jobs SET status='cancelled' WHERE task_id=? AND status IN ('pending','blocked','paused','failed') AND phase='prepare'").run(id);
    return this.setStatus(id,'cancelled');
  }
}
