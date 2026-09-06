import crypto from "node:crypto";
import { SUPPORTED_PLATFORMS } from '../../core/task.js';
import { ValidationError } from '../../core/errors.js';

export class AccountRepository {
  constructor(database) { this.database = database; }

  upsert(account) {
    const now = new Date().toISOString();
    const id = account.id || `${account.platform}_${crypto.randomUUID()}`;
    if(!SUPPORTED_PLATFORMS.includes(account.platform)) throw new ValidationError('不支持的平台');
    if(typeof id!=='string' || !/^[\p{L}\p{N}_-]{1,80}$/u.test(id)) throw new ValidationError('账号 ID 只允许字母、数字、中文、横线和下划线');
    const existing=this.get(id);
    if(existing && existing.platform!==account.platform) throw new ValidationError('账号 ID 已被其他平台使用，请设置不同的 ID');
    this.database.prepare(`
      INSERT INTO accounts(id, platform, nickname, profile_path, status, last_login_at, last_checked_at, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET platform = excluded.platform, nickname = excluded.nickname,
        profile_path = excluded.profile_path, status = excluded.status, last_login_at = excluded.last_login_at,
        last_checked_at = excluded.last_checked_at, enabled = excluded.enabled, updated_at = excluded.updated_at
    `).run(id, account.platform, account.nickname || "", account.profilePath, account.status || "unknown",
      account.lastLoginAt || null, account.lastCheckedAt || null, account.enabled === false ? 0 : 1, now, now);
    return this.get(id);
  }

  get(id) { return this.database.prepare("SELECT * FROM accounts WHERE id = ?").get(id) || null; }
  list(platform) {
    return platform
      ? this.database.prepare("SELECT * FROM accounts WHERE platform = ? ORDER BY nickname, id").all(platform)
      : this.database.prepare("SELECT * FROM accounts ORDER BY platform, nickname, id").all();
  }
  setStatus(id, status) {
    const now = new Date().toISOString();
    this.database.prepare("UPDATE accounts SET status = ?, last_checked_at = ?, updated_at = ? WHERE id = ?").run(status, now, now, id);
    if(status==='logged_in') this.database.prepare('UPDATE accounts SET last_login_at=? WHERE id=?').run(now,id);
    return this.get(id);
  }
  remove(id) { return Number(this.database.prepare("DELETE FROM accounts WHERE id = ?").run(id).changes); }
}
