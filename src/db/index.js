import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDataPaths } from "../config/paths.js";
import { applyMigrations } from "./migrations.js";
import { TaskRepository } from "./repositories/tasks.js";
import { AccountRepository } from "./repositories/accounts.js";
import { TemplateRepository } from "./repositories/templates.js";

export function openDatabase(filePath = getDataPaths().database) {
  if (filePath !== ":memory:") fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const database = new DatabaseSync(filePath);
  applyMigrations(database);
  const repositories = {
    tasks: new TaskRepository(database),
    accounts: new AccountRepository(database),
    templates: new TemplateRepository(database)
  };
  repositories.templates.seedDefaults();
  return {
    raw: database,
    ...repositories,
    settings: {
      get(key, fallback = null) {
        const row = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
        if (!row) return fallback;
        try { return JSON.parse(row.value); } catch { return row.value; }
      },
      set(key, value) {
        const now = new Date().toISOString();
        database.prepare(`
          INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(key, JSON.stringify(value), now);
        return value;
      }
    },
    logs: {
      add(entry) {
        const now = new Date().toISOString();
        const result = database.prepare(`
          INSERT INTO app_logs(level, message, task_id, job_id, platform, details, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(entry.level || "info", entry.message, entry.taskId || null, entry.jobId || null,
          entry.platform || null, JSON.stringify(entry.details || {}), now);
        return Number(result.lastInsertRowid);
      },
      list({ taskId, limit = 500 } = {}) {
        return taskId
          ? database.prepare("SELECT * FROM app_logs WHERE task_id = ? ORDER BY id DESC LIMIT ?").all(taskId, limit)
          : database.prepare("SELECT * FROM app_logs ORDER BY id DESC LIMIT ?").all(limit);
      }
    },
    close() { database.close(); }
  };
}
