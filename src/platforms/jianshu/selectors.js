import { commonLoggedIn, commonLoggedOut } from "../shared-selectors.js";

export const config = {
  platform: "jianshu", composerUrl: "https://www.jianshu.com/writer#/",
  loginUrlPattern: /jianshu\.com\/sign_in/i, postUrlPattern: /jianshu\.com\/p\/[a-f0-9]+/i, requiresTitle: true,
  selectors: {
    loggedOut: commonLoggedOut, loggedIn: ["a[href*='/users/']", ...commonLoggedIn],
    title: ["input[placeholder*='标题']", "input[name='title']"], editor: ["[contenteditable='true']", "textarea[placeholder*='正文']"],
    imageInput: ["input[type='file'][accept*='image']"], submit: ["button:has-text('发布文章')", "button:has-text('发布')"],
    success: ["text=发布成功", "text=已发布"], postLink: ["a:has-text('查看文章')", "a[href*='/p/']"]
  }
};
