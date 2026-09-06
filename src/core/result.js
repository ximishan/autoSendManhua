import { AppError } from './errors.js';

const patterns = {
  weibo: /^\/(?:\d+\/[A-Za-z0-9]+|detail\/\d+)\/?$/,
  zhihu: /^\/p\/\d+\/?$/,
  jianshu: /^\/p\/[a-f0-9]+\/?$/i,
  baijiahao: /^\/s$/,
  toutiao: /^\/article\/\d+\/?$/,
  sohu: /^\/a\/\d+[^/]*\/?$/,
  netease: /^\/dy\/article\/[A-Za-z0-9]+\.html$/
};
const hosts = {
  weibo: ['weibo.com','www.weibo.com'], zhihu:['zhuanlan.zhihu.com'],
  jianshu:['jianshu.com','www.jianshu.com'], baijiahao:['baijiahao.baidu.com'],
  toutiao:['toutiao.com','www.toutiao.com'], sohu:['sohu.com','www.sohu.com'],
  netease:['163.com','www.163.com']
};
export function validPostUrl(platform, value) {
  try {
    const u=new URL(value);
    return u.protocol==='https:' && !u.username && !u.password && !u.port && hosts[platform]?.includes(u.hostname)
      && patterns[platform]?.test(u.pathname) && (platform!=='baijiahao' || /^\d+$/.test(u.searchParams.get('id')||''));
  } catch { return false; }
}
export function validateResult(platform, result) {
  if (!result || result.success!==true) throw new AppError(result?.errorMessage || '平台未确认成功', {code:result?.errorCode || 'RESULT_REJECTED'});
  if (result.resultStatus==='rejected') throw new AppError(result.errorMessage || '平台拒绝发布', {code:'REJECTED',needsAction:true});
  const url=result.canonicalUrl || result.postUrl || '';
  if (result.resultStatus==='submitted' && platform!=='weibo') {
    if(!result.evidence?.submitted) throw new AppError('缺少本次提交证据',{code:'PUBLISH_UNCERTAIN',needsAction:true});
    return {...result,postUrl: validPostUrl(platform,url)?url:'',resultStatus:'submitted'};
  }
  if(!validPostUrl(platform,url)) throw new AppError('未取得有效的本平台帖子详情地址',{code:platform==='weibo'?'WEIBO_URL_NOT_RESOLVED':'PUBLISH_UNCERTAIN',needsAction:true});
  return {...result,resultStatus:'published'};
}
