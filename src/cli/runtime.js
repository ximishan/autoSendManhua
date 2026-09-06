import { openDatabase } from "../db/index.js";
import { BrowserManager } from "../browser/browser-manager.js";
import { createPublisher } from "../platforms/index.js";
import { AppLogger } from "../core/logger.js";
import { Workflow } from "../core/workflow.js";

export function createRuntime(options = {}) {
  const database = options.database || openDatabase(options.databasePath);
  const browserManager = options.browserManager || new BrowserManager(options.browserOptions);
  const logger = options.logger || new AppLogger({ database });
  const workflow = new Workflow({
    database,
    logger,
    retryPolicy:{maxAttempts:database.settings.get('retry.maxAttempts',2),baseDelayMs:1200,maxDelayMs:8000},
    preferShareUrl:database.settings.get('weibo.preferShareUrl',true),
    publisherFactory: (platform, publisherOptions) => createPublisher(platform, {
      ...publisherOptions,
      browserManager
    })
  });
  return { database, browserManager, logger, workflow };
}
