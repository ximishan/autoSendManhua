export const selectors = {
  composer: [
    "textarea[placeholder*='分享新鲜事']",
    "textarea[placeholder*='有什么新鲜事']",
    "[contenteditable='true'][role='textbox']",
    "[contenteditable='true'][data-testid*='composer']"
  ],
  imageInput: [
    "input[type='file'][accept*='image']",
    "input[type='file'][multiple]"
  ],
  imagePreview: [
    "[class*='picture'] img",
    "[class*='preview'] img",
    "[data-testid*='image'] img"
  ],
  submit: [
    "button:has-text('发布')",
    "[role='button']:has-text('发布')",
    "button[data-testid*='submit']"
  ],
  success: [
    "text=发布成功",
    "[role='alert']:has-text('成功')",
    "[class*='toast']:has-text('成功')"
  ],
  loggedIn: [
    "a[href*='/u/']",
    "a[href*='/profile']",
    "[class*='woo-avatar']",
    "[data-testid*='avatar']"
  ],
  loggedOut: [
    "input[placeholder*='手机号']",
    "input[placeholder*='邮箱']",
    "button:has-text('登录')",
    "a:has-text('注册')"
  ],
  postCards: ["article", "[class*='Feed_wrap']", "[data-testid*='feed']"]
};

export const publishApiPattern = /\/ajax\/statuses\/update(?:\?|$)/i;
