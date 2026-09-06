export const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        resource_url TEXT NOT NULL DEFAULT '',
        selected_platforms TEXT NOT NULL DEFAULT '[]',
        account_ids TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        nickname TEXT NOT NULL DEFAULT '',
        profile_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unknown',
        last_login_at TEXT,
        last_checked_at TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS publish_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        account_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        post_id TEXT NOT NULL DEFAULT '',
        post_url TEXT NOT NULL DEFAULT '',
        result_status TEXT NOT NULL DEFAULT '',
        started_at TEXT,
        finished_at TEXT,
        error_code TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(task_id, platform)
      );

      CREATE TABLE IF NOT EXISTS weibo_results (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        weibo_id TEXT NOT NULL DEFAULT '',
        mid TEXT NOT NULL DEFAULT '',
        bid TEXT NOT NULL DEFAULT '',
        user_id TEXT NOT NULL DEFAULT '',
        canonical_url TEXT NOT NULL DEFAULT '',
        share_url TEXT NOT NULL DEFAULT '',
        published_at TEXT,
        raw_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        content_template TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        task_id TEXT,
        job_id INTEGER,
        platform TEXT,
        details TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status ON publish_jobs(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_task ON publish_jobs(task_id);
      CREATE INDEX IF NOT EXISTS idx_logs_task ON app_logs(task_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_accounts_platform ON accounts(platform, enabled);
    `
  },
  {
    version: 2,
    sql: `ALTER TABLE publish_jobs ADD COLUMN phase TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE publish_jobs ADD COLUMN evidence TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE publish_jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_running_account ON publish_jobs(account_id) WHERE status='running' AND account_id IS NOT NULL;`
  },
  {
    version: 3,
    sql: `ALTER TABLE weibo_results ADD COLUMN account_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE weibo_results ADD COLUMN resolution TEXT NOT NULL DEFAULT '';
      ALTER TABLE weibo_results ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '{}';`
  }
];

export function applyMigrations(database) {
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const hasVersion = database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?");
  const recordVersion = database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)");

  for (const migration of migrations) {
    if (hasVersion.get(migration.version)) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      recordVersion.run(migration.version, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
