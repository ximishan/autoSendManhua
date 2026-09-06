export class AppError extends Error {
  constructor(message, { code = "APP_ERROR", retryable = false, needsAction = false, cause } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.code = code;
    this.retryable = retryable;
    this.needsAction = needsAction;
  }
}

export class ValidationError extends AppError {
  constructor(message, code = "VALIDATION_ERROR") {
    super(message, { code });
  }
}

export class LoginRequiredError extends AppError {
  constructor(platform) {
    super(`${platform} 登录状态失效或需要人工验证`, {
      code: "LOGIN_REQUIRED",
      needsAction: true
    });
    this.platform = platform;
  }
}

export class PublishUncertainError extends AppError {
  constructor(platform, message = "提交结果无法确认，已停止自动重试以避免重复发布") {
    super(`${platform}: ${message}`, { code: "PUBLISH_UNCERTAIN" });
    this.platform = platform;
  }
}

export function normalizeError(error) {
  return {
    code: error?.code || "UNEXPECTED_ERROR",
    message: error?.message || String(error),
    retryable: Boolean(error?.retryable),
    needsAction: Boolean(error?.needsAction),
    stack: error?.stack || ""
  };
}
