// Real HTTP and persistent local auth. Does not call a paid model or mock any service.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const base='http://127.0.0.1:3000';
let cookie=''; const checks=[];
async function api(path,method='GET',body) {
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:base,...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  const values=response.headers.getSetCookie();
  if(values.length)cookie=values.map(value=>value.split(';')[0]).join('; ');
  return {status:response.status,body:await response.json()};
}
const email=`smoke-${randomUUID()}@example.com`;
const password=`Smoke${randomBytes(18).toString('hex')}`;
assert.equal((await api('/api/projects')).status,401); checks.push('未登录读取项目被拒绝');
let result=await api('/api/auth/register','POST',{email,password,confirmPassword:password});
assert.equal(result.status,200); const userId=result.body.user.id;
checks.push('真实注册成功并建立会话');
assert.equal((await api('/api/session')).body.user.id,userId); checks.push('真实会话读取成功');
assert.equal((await api('/api/projects')).status,200); checks.push('已登录可以读取自己项目列表');
const duplicate=await api('/api/auth/register','POST',{email,password,confirmPassword:password});
assert.equal(duplicate.status,409);checks.push('重复邮箱不能注册第二个账号');
await api('/api/auth/logout','POST');
assert.equal((await api('/api/projects')).status,401);checks.push('退出后会话失效');
assert.equal((await api('/api/auth/login','POST',{email,password:'WrongPassword123'})).status,401); checks.push('错误密码登录被拒绝');
result=await api('/api/auth/login','POST',{email,password});assert.equal(result.status,200);
assert.equal(result.body.user.id,userId);checks.push('正确密码重新登录恢复同一账号');
const setup=(await api('/api/session')).body.setup;
if(!setup.model){
  const generation=await api('/api/generate','POST',{requestId:randomUUID(),projectId:randomUUID(),revision:0,prompt:'创建待办清单'});
  assert.equal(generation.status,503); assert.equal(generation.body.code,'SETUP_REQUIRED');checks.push('无模型密钥时明确拒绝生成，没有假成功');
}
await api('/api/auth/logout','POST');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const directory=`E:/test/testing/20260924-local-v2/${stamp}`;await mkdir(directory,{recursive:true});
const report={date:new Date().toISOString(),environment:'本机生产服务，真实 HTTP 与落盘数据库，无模拟响应',checks,authStatus:'passed',generationStatus:setup.model?'未执行，需真实模型主流程验收':'阻塞：未配置模型密钥',modelCalls:0};
await writeFile(`${directory}/auth-smoke.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,evidence:directory},null,2));
