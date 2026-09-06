import { commonLoggedIn, commonLoggedOut } from "../shared-selectors.js";

export const config = {
  platform: "netease", composerUrl: "https://mp.163.com/#/article/manage",
  loginUrlPattern: /reg\.163\.com|login/i, postUrlPattern: /163\.com\/dy\/article\//i, requiresTitle: true,
  selectors: {
    entry: ["button:has-text('发布文章')", "a:has-text('发布文章')"], loggedOut: commonLoggedOut,
    loggedIn: ["[class*='user-avatar']", ...commonLoggedIn], title: ["input[placeholder*='标题']", "textarea[placeholder*='标题']"],
    editor: ["[contenteditable='true']", ".ProseMirror"], imageInput: ["input[type='file'][accept*='image']"],
    submit: ["button:has-text('发布')", "button:has-text('提交')"], success: ["text=发布成功", "text=提交成功", "text=审核中"],
    postLink: ["a:has-text('查看文章')"]
  }
};
