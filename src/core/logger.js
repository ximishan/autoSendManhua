import fs from "node:fs";
import path from "node:path";
import { getDataPaths } from "../config/paths.js";

function redact(value) {
  if(typeof value==='string')return value.replace(/((?:cookie|token|authorization|password|secret)\s*[:=]\s*)[^\r\n]+/ig,'$1[REDACTED]');
  if (!value || typeof value !== "object") return value;
  const output = Array.isArray(value) ? [] : {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = /cookie|token|authorization|password/i.test(key) ? "[REDACTED]" : redact(child);
  }
  return output;
}

export class AppLogger {
  constructor({ database, logDir = getDataPaths().logs, onEntry } = {}) {
    this.database = database;
    this.logDir = logDir;
    this.onEntry = onEntry;
    fs.mkdirSync(logDir, { recursive: true });
  }

  prune(days=30) {
    if(!Number.isInteger(days)||days<1||days>365)throw new Error('日志保留天数应为1–365');
    const cutoff=new Date(Date.now()-days*86400000).toISOString().slice(0,10);
    for(const file of fs.readdirSync(this.logDir)) {
      if(/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)&&file.slice(0,10)<cutoff)fs.unlinkSync(path.join(this.logDir,file));
    }
    this.database?.raw.prepare('DELETE FROM app_logs WHERE created_at < ?').run(cutoff);
  }

  write(level, message, context = {}) {
    const entry = redact({ level, message, ...context, details: context.details || {} });
    this.database?.logs.add(entry);
    const line = `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`;
    fs.appendFileSync(path.join(this.logDir, `${new Date().toISOString().slice(0, 10)}.jsonl`), line, "utf8");
    this.onEntry?.(entry);
    return entry;
  }

  info(message, context) { return this.write("info", message, context); }
  warn(message, context) { return this.write("warn", message, context); }
  error(message, context) { return this.write("error", message, context); }
}
