import { DEFAULT_TEMPLATES, validateTemplate } from "../../core/template-engine.js";

export class TemplateRepository {
  constructor(database) { this.database = database; }

  seedDefaults() {
    const now = new Date().toISOString();
    const statement = this.database.prepare(`
      INSERT INTO templates(platform, name, content_template, enabled, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(platform) DO NOTHING
    `);
    for (const [platform, content] of Object.entries(DEFAULT_TEMPLATES)) {
      statement.run(platform, `${platform} 默认模板`, content, now, now);
    }
  }

  get(platform) { return this.database.prepare("SELECT * FROM templates WHERE platform = ?").get(platform) || null; }
  list() { return this.database.prepare("SELECT * FROM templates ORDER BY platform").all(); }
  save(platform, contentTemplate, { name = `${platform} 模板`, enabled = true } = {}) {
    validateTemplate(platform, contentTemplate);
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO templates(platform, name, content_template, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform) DO UPDATE SET name = excluded.name, content_template = excluded.content_template,
        enabled = excluded.enabled, updated_at = excluded.updated_at
    `).run(platform, name, contentTemplate, enabled ? 1 : 0, now, now);
    return this.get(platform);
  }
}
