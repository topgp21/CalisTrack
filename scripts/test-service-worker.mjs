/** Browser cache upgrade / live HTTPS checks. No user profile, login, or production workout writes. */
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {lineSummary} from '../tests/fixtures/workout-summary.mjs';
const root=new URL('../public/',import.meta.url),live=process.argv[2];
const oldWorker=await readFile(new URL('../tests/fixtures/sw-v6.js',import.meta.url),'utf8');
let oldMode=true,browser,server;
const hash=v=>createHash('sha256').update(v).digest('hex');
async function checkBrowserFiles(page,base){
 const files=['app.js?v=7','import-dialog.js?v=7','import-workout.js?v=7'];
 for(const file of files){const response=await page.request.get(new URL(file,base).href,{headers:{'Cache-Control':'no-cache'}});assert.equal(response.status(),200);assert.equal(hash(await response.body()),hash(await readFile(new URL(file,root))));}
 // The page's fetch is intercepted by the actual controlling worker, unlike APIRequestContext above.
 for(const file of files){const text=await page.evaluate(async url=>{const r=await fetch(url,{cache:'no-cache'});if(!r.ok)throw Error('HTTP '+r.status);return r.text();},new URL(file,base).href);assert.equal(hash(text),hash(await readFile(new URL(file,root))));}
 assert.equal(await page.evaluate(()=>!!navigator.serviceWorker.controller),true);
 console.log('PASS browser + controlling Service Worker: current JavaScript source hashes match');
}
async function verifyPreview(page){
 await page.getByRole('button',{name:'ייבוא אימון מ־ChatGPT',exact:true}).click();await page.locator('#import-text').fill(lineSummary);await page.locator('#parse-import').click();
 assert.equal(await page.locator('#import-count').innerText(),'10 מתוך 10 סטים זוהו');assert.equal(await page.locator('dialog fieldset').count(),10);assert.equal(await page.locator('[data-unresolved]').count(),0);
 await page.locator('#import-close').click();
 const untouched=await page.evaluate(async()=>{const {read}=await import('./store.js');const s=await read();return {records:Object.keys(s.records).length,queue:s.queue.length};});assert.deepEqual(untouched,{records:0,queue:0});
}
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:412,height:915},locale:'he-IL',timezoneId:'Asia/Jerusalem'});
 context.setDefaultTimeout(30000);
 let base;
 if(live){base=new URL(live);assert.equal(base.protocol,'https:');}
 else{
  server=createServer(async(req,res)=>{try{
   const path=new URL(req.url,'http://localhost').pathname;const url=new URL('.'+(path==='/'?'/index.html':path),root);if(!url.href.startsWith(root.href))throw Error('path');
   res.setHeader('Cache-Control','no-cache');res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.webmanifest')?'application/manifest+json':'text/html');
   if(oldMode&&(path==='/'||path==='/index.html'))return res.end('<!doctype html><title>Isolated legacy shell</title>');
   if(oldMode&&path==='/sw.js')return res.end(oldWorker);
   if(oldMode&&path==='/import-workout.js')return res.end('export const legacyParser=true;');
   res.end(await readFile(url));
  }catch{res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=new URL(`http://127.0.0.1:${server.address().port}/`);
  const legacy=await context.newPage();await legacy.goto(base.href);
  await legacy.evaluate(async()=>{await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});await navigator.serviceWorker.ready;});await legacy.reload();
  assert.equal(await legacy.evaluate(()=>!!navigator.serviceWorker.controller),true);
  assert.match(await legacy.evaluate(async()=>{const cache=await caches.open('calistrack-shell-v6');return (await cache.match('./import-workout.js')).text();}),/legacyParser/);
  oldMode=false;
  await legacy.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
  await legacy.waitForFunction(async()=>{const r=await navigator.serviceWorker.getRegistration();return !!r.waiting;});
  // Wait for natural activation after the old window closes. Never force reload an active workout.
  await legacy.close();console.log('PASS: installed legacy v6 cache and downloaded v7 upgrade without forcing a live-page reload');
 }
 const page=await context.newPage();await page.goto(new URL('?release='+encodeURIComponent(process.env.GITHUB_SHA||'v7')+'#history',base).href);
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.reload();
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 assert.equal(await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return r.updateViaCache;}),'none');
 await checkBrowserFiles(page,base);await verifyPreview(page);
 if(!live){const keys=await page.evaluate(()=>caches.keys());assert.ok(keys.includes('calistrack-shell-v7'));assert.ok(!keys.includes('calistrack-shell-v6'));}
 // Deliberately seed stale JS in another cache: offline fallback must use v7 only.
 await page.evaluate(async()=>{const stale=await caches.open('calistrack-shell-v6');await stale.put('./import-workout.js?v=7',new Response('export const legacyParser=true;'));});
 await context.setOffline(true);await page.reload();await verifyPreview(page);
 const cached=await page.evaluate(async()=>{const r=await fetch('./import-workout.js?v=7');return r.text();});assert.equal(hash(cached),hash(await readFile(new URL('import-workout.js',root))));
 console.log('PASS: offline browser receives v7 JavaScript despite stale v6 cache; ten structured sets; zero workouts or sync operations created'+(live?' on live HTTPS site':''));
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
