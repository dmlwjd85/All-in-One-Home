/* 실제 Start를 가짜 인증·동기화로 구동합니다. OAuth 컨테이너 왕복은 실기기 검증 대상입니다. */
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { loginDeadline, loginHint, signInGoogle, finishRedirectSignIn, useFirebaseForTest } from '../src/firebase.js';
await assert.rejects(loginDeadline(new Promise(() => {}), 10), { code: 'auth/login-timeout' });
assert.equal(await loginDeadline(Promise.resolve('ok'), 10), 'ok');
assert.match(loginHint({ code: 'auth/login-timeout' }), /Safari/);
globalThis.location = { host: 'example.github.io' };
globalThis.window = {};
globalThis.navigator = {};
let redirected = false;
useFirebaseForTest({ config: { projectId: 'test' }, bundle: { memoryOnly: false, auth: { config: { authDomain: 'test.firebaseapp.com' } } }, authModule: {
    GoogleAuthProvider: class { setCustomParameters() {} },
    signInWithPopup: async () => { throw Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' }); },
    signInWithRedirect: async () => { redirected = true; },
    getRedirectResult: async () => { throw Object.assign(new Error('storage'), { code: 'auth/web-storage-unsupported' }); },
} });
await assert.rejects(signInGoogle(), { code: 'auth/popup-needs-browser' });
assert.equal(redirected, false, '교차 도메인 redirect 루프');
await assert.rejects(finishRedirectSignIn(), { code: 'auth/web-storage-unsupported' });
useFirebaseForTest({ bundle: null });
const dir = mkdtempSync(join(tmpdir(), 'ios-login-'));
const mock = `
let state={auth:null,profile:{},students:[]}; const listeners=new Set();
export const snapshot=()=>state;
export const subscribe=fn=>{listeners.add(fn);return ()=>listeners.delete(fn)};
window.restore=()=>{state.auth={uid:'test'};listeners.forEach(fn=>fn(state))};
export const setAuth=()=>window.mode==='pending'?new Promise(resolve=>window.resolveSync=resolve):window.mode==='reject'?Promise.reject(new Error('offline')):Promise.resolve(window.mode!=='fail');
export const previewLegacy=()=>null;
export const patchProfile=async()=>{};
export const applyLegacy=async()=>({});
export const finishSetup=async()=>({storageFailed:true});
export const loadDemo=finishSetup;
export const cloudReady=()=>true;
export const loginHint=()=> '로그인 오류';
export const signInGoogle=async()=>null;
export const useUi=()=>({showToast:()=>{},go:()=>window.navigated=true});
`;
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {Start} from './src/ui/Start.jsx';createRoot(document.getElementById('root')).render(<Start/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,outfile:join(dir,'app.js'),format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fake-auth',setup(b){b.onResolve({filter:/(lib\/db\.js|firebase\.js|\/context\.jsx)$/},a=>({path:'shared',namespace:'fake'}));b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:mock,loader:'js'}));}}],logLevel:'silent'});
writeFileSync(join(dir,'index.html'),'<div id="root"></div><script src="app.js"></script>');
const chrome=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--allow-file-access-from-files']});
try {
 for(const mode of ['ok','pending','reject','fail']) {
  const page=await browser.newPage();
  await page.goto(`file://${dir}/index.html`);
  await page.waitForSelector('[data-start="google"]');
  // redirect credential 없이 observer 복원만으로 재개합니다.
  await page.evaluate(m=>{window.mode=m;window.restore()},mode);
  if(mode==='ok') {
   await page.waitForSelector('input[aria-label="학급 이름"]');
   await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='나중에 할게요').click());
   assert.equal(await page.evaluate(()=>Boolean(window.navigated)),false,'저장 실패인데 이동');
  } else {
   await page.waitForFunction(()=>document.body.textContent.includes('기존 학급 자료'));
   assert.equal(await page.$('input[aria-label="학급 이름"]'),null,'원격 확인 전 명단 노출');
   if(mode!=='pending') await page.waitForFunction(()=>document.body.textContent.includes('자료 다시 확인'));
   else {
    await page.evaluate(()=>window.resolveSync(true));
    await page.waitForSelector('input[aria-label="학급 이름"]');
   }
  }
  await page.close();
 }
}finally{await browser.close()}
const cloud=readFileSync('src/lib/cloud.js','utf8');
assert.ok(!cloud.includes('await finishRedirectSignIn();'),'observer가 redirect 대기에 종속');
console.log('check:ioslogin ok — redirect 복원·sync pending/reject/fail·저장 실패·popup timeout');
