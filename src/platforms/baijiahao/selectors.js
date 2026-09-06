import { commonLoggedIn, commonLoggedOut } from "../shared-selectors.js";

export const config = {
  platform: "baijiahao", composerUrl: "https://baijiahao.baidu.com/builder/rc/edit?type=news",
  loginUrlPattern: /passport\.baidu\.com/i, postUrlPattern: /baijiahao\.baidu\.com\/s\?id=/i, requiresTitle: true, submissionOnly: true,
  selectors: {
    loggedOut: commonLoggedOut, loggedIn: ["[class*='user-info']", ...commonLoggedIn],
    title: ["textarea[placeholder*='标题']", "input[placeholder*='标题']"], editor: ["[contenteditable='true']", ".ProseMirror"],
    imageInput: ["input[type='file'][accept*='image']"], submit: ["button:has-text('发布')", "button:has-text('提交')"],
    success: ["text=发布成功", "text=提交成功", "text=审核中"], postLink: ["a:has-text('查看内容')"]
  }
};
