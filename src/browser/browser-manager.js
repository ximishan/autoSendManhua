import { openPersistentBrowser } from "./profile-manager.js";

export class BrowserManager {
  constructor(options = {}) {
    this.options = options;
    this.sessions = new Map();
    this.opening = new Map();
  }

  key(platform, accountId = "default") { return `${platform}:${accountId}`; }

  async getSession(platform, accountId = "default", options = {}) {
    const key = this.key(platform, accountId);
    if (this.sessions.has(key)) return this.sessions.get(key);
    if(this.opening.has(key)) return this.opening.get(key);
    const pending=this.open(platform,accountId,options,key).finally(()=>this.opening.delete(key));
    this.opening.set(key,pending);return pending;
  }

  async open(platform,accountId,options,key) {
    const session = await openPersistentBrowser(platform, {
      ...this.options,
      ...options,
      accountId
    });
    session.context.on("close", () => this.sessions.delete(key));
    this.sessions.set(key, session);
    return session;
  }

  async close(platform, accountId = "default") {
    const key = this.key(platform, accountId);
    const session = this.sessions.get(key);
    if (session) await session.close();
    this.sessions.delete(key);
  }

  async closeAll() {
    await Promise.allSettled([...this.opening.values()]);
    await Promise.allSettled([...this.sessions.values()].map((session) => session.close()));
    this.sessions.clear();
  }
}
