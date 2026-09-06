import { WeiboPublisher } from "./weibo/publisher.js";
import { BrowserPlatformPublisher } from "./browser-platform-publisher.js";
import { platformConfigs } from "./configs.js";

export function createPublisher(platform, options = {}) {
  if (platform === "weibo") return new WeiboPublisher(options);
  const config = platformConfigs[platform];
  if (!config) throw new Error(`尚未注册平台发布器：${platform}`);
  return new BrowserPlatformPublisher({ ...options, config });
}

export { platformConfigs };
