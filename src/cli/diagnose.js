import { openDatabase } from '../db/index.js';
import { BrowserManager } from '../browser/browser-manager.js';
import { createPublisher } from '../platforms/index.js';
import { selectors as weiboSelectors } from '../platforms/weibo/selectors.js';
import { platformConfigs } from '../platforms/configs.js';

const [platform,accountId]=process.argv.slice(2);
if(!platform||!accountId){console.error('用法：npm run diagnose -- <platform> <accountId>（只检测，不发布）');process.exit(2);}
const db=openDatabase();const browsers=new BrowserManager();
try {
  const account=db.accounts.get(accountId);
  if(!account||account.platform!==platform)throw new Error('账号不存在或平台不匹配');
  if(db.raw.prepare("SELECT 1 FROM publish_jobs WHERE account_id=? AND status='running'").get(accountId))throw new Error('账号正在使用');
  const publisher=createPublisher(platform,{account,browserManager:browsers});
  const loggedIn=await publisher.checkLogin();
  db.accounts.setStatus(accountId,loggedIn?'logged_in':'needs_login');
  const page=await publisher.getPage();
  const selectors=platform==='weibo'?weiboSelectors:platformConfigs[platform].selectors;
  const matches={};
  for(const key of ['composer','title','editor','imageInput','submit']) {
    matches[key]=[];
    for(const selector of selectors[key]||[])matches[key].push({selector,count:await page.locator(selector).count().catch(()=>0)});
  }
  console.log(JSON.stringify({platform,accountId,loggedIn,mode:'read-only-diagnostic',matches},null,2));
  if(!loggedIn)process.exitCode=2;
}catch(e){console.error(e.message);process.exitCode=1;}finally{await browsers.closeAll();db.close();}
