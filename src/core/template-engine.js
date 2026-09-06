import { ValidationError } from "./errors.js";

const ALLOWED_VARIABLES = new Set(["title", "content", "resourceUrl", "weiboUrl", "date"]);
const VARIABLE_PATTERN = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

export const DEFAULT_TEMPLATES = {
  weibo: "{content}\n\n{resourceUrl}",
  zhihu: "{content}\n\n更多内容：{weiboUrl}",
  jianshu: "{content}\n\n更多内容：{weiboUrl}",
  baijiahao: "{content}\n\n更多内容：{weiboUrl}",
  toutiao: "{content}\n\n更多内容：{weiboUrl}",
  sohu: "{content}\n\n更多内容：{weiboUrl}",
  netease: "{content}\n\n更多内容：{weiboUrl}"
};

export function validateTemplate(platform, template) {
  const variables = [...String(template).matchAll(VARIABLE_PATTERN)].map((match) => match[1]);
  const unknown = variables.filter((name) => !ALLOWED_VARIABLES.has(name));
  if (unknown.length) throw new ValidationError(`模板包含未知变量：${[...new Set(unknown)].join(", ")}`);
  if (platform !== "weibo" && variables.includes("resourceUrl")) {
    throw new ValidationError(`${platform} 模板默认禁止直接使用 resourceUrl，请使用 weiboUrl`);
  }
  return true;
}

export function renderTemplate(platform, template, values, { allowDownstreamResourceUrl = false } = {}) {
  if (allowDownstreamResourceUrl) {
    const variables = [...String(template).matchAll(VARIABLE_PATTERN)].map((match) => match[1]);
    const unknown = variables.filter((name) => !ALLOWED_VARIABLES.has(name));
    if (unknown.length) throw new ValidationError(`模板包含未知变量：${unknown.join(", ")}`);
  } else {
    validateTemplate(platform, template);
  }
  const context = {
    title: values.title || "",
    content: values.content || "",
    resourceUrl: values.resourceUrl || "",
    weiboUrl: values.weiboUrl || "",
    date: values.date || new Date().toISOString().slice(0, 10)
  };
  return String(template).replace(VARIABLE_PATTERN, (_, name) => context[name] ?? "").trim();
}
