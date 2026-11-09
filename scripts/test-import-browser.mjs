/** Isolated phone-sized browser test. All non-local requests are blocked. */
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {lineSummary as summary} from '../tests/fixtures/workout-summary.mjs';
const root=new URL('../public/',import.meta.url);
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const url=new URL('.'+(path==='/'?'/index.html':path),root);if(!url.href.startsWith(root.href))throw Error('path');const bytes=await readFile(url);res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html');res.end(bytes);}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CALISTRACK_CHROMIUM?{executablePath:process.env.CALISTRACK_CHROMIUM}:{})});
 const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,locale:'he-IL',timezoneId:'Asia/Jerusalem',serviceWorkers:'block'});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/#history');await page.getByRole('button',{name:'ייבוא אימון מ־ChatGPT',exact:true}).click();
 await page.locator('#import-text').fill(summary);await page.locator('#parse-import').click();
 assert.equal(await page.locator('dialog fieldset').count(),10);assert.equal(await page.locator('#import-count').innerText(),'10 מתוך 10 סטים זוהו');assert.equal(await page.locator('[data-unresolved]').count(),0);assert.equal(await page.locator('#import-date').inputValue(),'2026-11-09');
 assert.equal(await page.locator('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 await page.locator('[data-row="0"][data-field="difficulty"]').fill('');await page.locator('#save-import').click();assert.match(await page.locator('#import-error').innerText(),/קושי/);
 // Cancel does not create records.
 await page.locator('#import-close').click();
 const readState=()=>page.evaluate(async()=>{const {read}=await import('./store.js');return read();});assert.equal(Object.keys((await readState()).records).length,0);
 // An unparsed tenth line stays visible and blocks saving; the original remains intact.
 await page.getByRole('button',{name:'ייבוא אימון מ־ChatGPT',exact:true}).click();
 const broken=summary.replace('פלאנק סט 2: 30 שניות, קושי קשה','פלאנק סט 2: לא זוכר שניות, קושי קשה');
 await page.locator('#import-text').fill(broken);await page.locator('#parse-import').click();
 assert.equal(await page.locator('#import-count').innerText(),'9 מתוך 10 סטים זוהו');assert.equal(await page.locator('[data-unresolved]').getAttribute('readonly'),'');
 await page.locator('#save-import').click();assert.match(await page.locator('#import-error').innerText(),/שלא פוענח/);assert.equal(Object.keys((await readState()).records).length,0);
 assert.equal(await page.locator('.import-original').textContent(),broken);await page.locator('#back-import').click();assert.equal(await page.locator('#import-text').inputValue(),broken);
 await page.locator('#import-text').fill(summary);await page.locator('#parse-import').click();assert.equal(await page.locator('#import-count').innerText(),'10 מתוך 10 סטים זוהו');assert.equal(await page.locator('.import-original').textContent(),broken);await page.locator('#import-close').click();
 // Seed a fixture through real IndexedDB, then ensure import leaves it untouched.
 const existing={id:'existing-fixture',type:'workout',start:'2026-11-01T10:00:00Z',end:'2026-11-01T10:20:00Z',week:1,revision:1,sets:[{id:'existing-set',exercise:'pushup',index:1,target:'5–8',actual:5,done:true,difficulty:'רגילה'}]};
 await page.evaluate(async existing=>{const {read,write}=await import('./store.js');const s=await read();s.records[existing.id]=existing;await write(s);},existing);await page.reload();
 const open=async()=>{await page.getByRole('button',{name:'ייבוא אימון מ־ChatGPT',exact:true}).click();await page.locator('#import-text').fill(summary);await page.locator('#parse-import').click();};await open();
 await page.locator('#import-date').fill('2026-11-08');await page.locator('[data-row="0"][data-field="actual"]').fill('7');await page.locator('#save-import').click();await page.locator('dialog').waitFor({state:'detached'});
 let s=await readState();assert.equal(Object.keys(s.records).length,2);assert.deepEqual(s.records[existing.id],existing);assert.equal(s.queue.length,1);
 const imported=s.queue[0].record;assert.equal(imported.workoutDate,'2026-11-08');assert.equal(imported.sets.length,10);assert.equal(imported.sets[0].actual,7);assert.equal(imported.sets.filter(x=>x.done).length,10);
 await page.reload();s=await readState();assert.equal(s.queue.length,1);assert.deepEqual(s.records[imported.id],imported);
 await open();await page.locator('#save-import').click();assert.match(await page.locator('#import-error').innerText(),/כבר/);assert.equal(Object.keys((await readState()).records).length,2);
 await page.locator('#import-close').click();await page.locator('#theme').click();await open();assert.equal(await page.locator('dialog').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(27, 44, 38)');
 assert.deepEqual(errors,[]);
 console.log('PASS: mobile RTL preview, validation, cancel, corrections, real IndexedDB reload, pending sync queue, duplicate protection, unchanged existing record, dark theme. No production requests.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
