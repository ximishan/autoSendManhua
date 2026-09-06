import { commonLoggedIn, commonLoggedOut } from "../shared-selectors.js";

export const config = {
  platform: "sohu", composerUrl: "https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle",
  loginUrlPattern: /mp\.sohu\.com.*login/i, postUrlPattern: /sohu\.com\/a\/\d+/i, requiresTitle: true,
  selectors: {
    loggedOut: commonLoggedOut, loggedIn: ["[class*='user-avatar']", ...commonLoggedIn],
    title: ["input[placeholder*='标题']", "textarea[placeholder*='标题']"], editor: ["[contenteditable='true']", ".ProseMirror"],
    imageInput: ["input[type='file'][accept*='image']"], submit: ["button:has-text('发布')", "button:has-text('提交')"],
    success: ["text=发布成功", "text=提交成功"], postLink: ["a:has-text('查看文章')"]
  }
};
