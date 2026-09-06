import { commonLoggedIn, commonLoggedOut } from "../shared-selectors.js";

export const config = {
  platform: "toutiao", composerUrl: "https://mp.toutiao.com/profile_v4/graphic/publish",
  loginUrlPattern: /sso\.toutiao\.com|login/i, postUrlPattern: /toutiao\.com\/article\/\d+/i, requiresTitle: true, submissionOnly: true,
  selectors: {
    loggedOut: commonLoggedOut, loggedIn: ["[class*='user-avatar']", ...commonLoggedIn],
    title: ["textarea[placeholder*='标题']", "input[placeholder*='标题']"], editor: ["[contenteditable='true']", ".ProseMirror"],
    imageInput: ["input[type='file'][accept*='image']"], submit: ["button:has-text('发布')", "button:has-text('确认发布')"],
    success: ["text=发布成功", "text=审核中", "text=已提交"], postLink: ["a:has-text('查看')"]
  }
};
