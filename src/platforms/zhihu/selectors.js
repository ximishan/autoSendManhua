import { commonLoggedIn, commonLoggedOut } from "../shared-selectors.js";

export const config = {
  platform: "zhihu", composerUrl: "https://zhuanlan.zhihu.com/write",
  loginUrlPattern: /zhihu\.com\/(?:signin|login)/i, postUrlPattern: /zhuanlan\.zhihu\.com\/p\/\d+/i, requiresTitle: true,
  selectors: {
    loggedOut: commonLoggedOut, loggedIn: ["[data-za-detail-view-element_name='Avatar']", ...commonLoggedIn],
    title: ["textarea[placeholder*='标题']", "input[placeholder*='标题']"],
    editor: ["[contenteditable='true'][role='textbox']", ".public-DraftEditor-content[contenteditable='true']"],
    imageInput: ["input[type='file'][accept*='image']"], submit: ["button:has-text('发布')", "button:has-text('提交')"],
    success: ["text=发布成功", "text=文章发布成功"], postLink: ["a:has-text('查看文章')"]
  }
};
