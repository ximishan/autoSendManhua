export class TaskQueue {
  constructor({ database, workflow, intervalMs = 1500 }) {
    this.database = database;
    this.workflow = workflow;
    this.intervalMs = intervalMs;
    this.running = false;
    this.paused = true;
    this.activeTask = null;
    this.timer = null;
  }

  recover() { return this.database.tasks.recoverInterrupted(); }

  start() {
    this.running = true;
    this.paused = false;
    this.workflow.queuePaused=false;
    this.schedule(0);
  }

  pause() { this.paused = true; for(const id of this.workflow.active?.keys()||[])this.database.tasks.setStatus(id,'paused'); }
  resume() { this.paused = false; this.workflow.queuePaused=false; if (this.running) this.schedule(0); }
  stop() { this.running = false; clearTimeout(this.timer); this.timer = null; }

  schedule(delay = this.intervalMs) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), delay);
  }

  async tick() {
    if (!this.running) return;
    if (this.paused || this.activeTask) return this.schedule();
    const oldest=this.database.raw.prepare("SELECT id FROM tasks WHERE status='pending' ORDER BY created_at,id LIMIT 1").get();
    const task=oldest && this.database.tasks.get(oldest.id);
    if (!task) return this.schedule();
    this.activeTask = task.id;
    try { await this.workflow.runTask(task.id); }
    catch(error) { this.database.tasks.setStatus(task.id,'paused'); this.workflow.log?.('error',error.message,{taskId:task.id}); }
    finally { this.activeTask = null; if(this.running)this.schedule(this.intervalMs); }
  }

  async drainOnce() {
    const tasks = this.database.tasks.list({ limit: 1000 }).reverse().filter((item) => item.status === "pending");
    const results = [];
    for (const task of tasks) results.push(await this.workflow.runTask(task.id));
    return results;
  }
}
