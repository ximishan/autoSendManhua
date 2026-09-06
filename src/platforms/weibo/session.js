export const WEIBO_HOME = "https://weibo.com/";

export async function openWeiboHome(page) {
  await page.goto(WEIBO_HOME, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
  await page.waitForTimeout(1500);
}

export async function detectWeiboLogin(page) {
  const identity=await readWeiboIdentity(page);
  return Boolean(identity);
}

export async function readWeiboIdentity(page) {
  try {
    if(!['weibo.com','www.weibo.com'].includes(new URL(page.url()).hostname))return null;
    const payload=await page.evaluate(async()=>{
      const response=await fetch('/ajax/config',{credentials:'same-origin',signal:AbortSignal.timeout(15000)});
      return response.ok?await response.json():null;
    });
    if(!payload)return null;
    const data=payload.data;
    if(payload.ok===1 && (data?.login===true || data?.login===1) && /^\d+$/.test(String(data.uid))) return {uid:String(data.uid)};
  }catch{}
  return null;
}
