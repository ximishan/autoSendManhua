import { LoginRequiredError } from "../core/errors.js";

export class PlatformPublisher {
  constructor({ platform, account, browserManager, logger, guard=()=>{}, checkpoint=()=>{} } = {}) {
    this.platform = platform;
    this.account = account;
    this.browserManager = browserManager;
    this.logger = logger;
    this.guard=guard;
    this.checkpoint=checkpoint;
  }

  async checkLogin() { throw new Error("checkLogin() 未实现"); }
  async openComposer() { throw new Error("openComposer() 未实现"); }
  async fillTitle() {}
  async fillContent() { throw new Error("fillContent() 未实现"); }
  async uploadImages() {}
  async submit() { throw new Error("submit() 未实现"); }
  async resolvePublishedUrl() { throw new Error("resolvePublishedUrl() 未实现"); }

  async publish(task, rendered) {
    this.guard();
    const loggedIn = await this.checkLogin(task);
    if (!loggedIn) throw new LoginRequiredError(this.platform);
    await this.openComposer(task);
    this.guard();
    await this.fillTitle(task, rendered);
    await this.fillContent(task, rendered);
    await this.uploadImages(task);
    this.guard();
    const submitResult = await this.submit(task);
    this.checkpoint('resolving',submitResult.evidence || {});
    return this.resolvePublishedUrl(task, submitResult, rendered);
  }
}
