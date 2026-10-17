/** Real HTTPS smoke check. This does not execute a browser or verify cloud workout storage. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deploymentConfig} from '../public/deployment-config.js';
const origin=new URL(process.argv[2]);assert.equal(origin.protocol,'https:');
const shell=['index.html','app.js','diagnostics.js','core.js','store.js','deployment-config.js','style.css','sw.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png'];
const sha=v=>createHash('sha256').update(v).digest('hex');
for(const file of shell){
 const url=new URL(file==='index.html'?'./':file,origin);
 let bytes,last;
 const local=await fs.readFile(new URL('../public/'+file,import.meta.url));
 for(let attempt=0;attempt<6;attempt++){
  try{url.searchParams.set('release',process.env.GITHUB_SHA||String(Date.now()));const response=await fetch(url,{signal:AbortSignal.timeout(15000)});assert.equal(response.status,200,file+' HTTP status');assert.equal(new URL(response.url).protocol,'https:');bytes=Buffer.from(await response.arrayBuffer());assert.equal(sha(bytes),sha(local),file+' differs from deployed source');last=null;break;}catch(e){last=e;if(attempt<5)await new Promise(resolve=>setTimeout(resolve,5000));}
 }
 if(last)throw last;
 console.log('PASS HTTPS + source match: '+file);
}
const manifest=JSON.parse(await fs.readFile(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));
assert.equal(manifest.dir,'rtl');assert.equal(new URL(manifest.start_url,origin).origin,origin.origin);
console.log('PASS: deployed HTTPS shell and PWA assets verified. Browser installation and Google integration are separate checks.');

if(deploymentConfig.url){
 const endpoint=new URL(deploymentConfig.url);assert.equal(endpoint.protocol,'https:');assert.equal(endpoint.hostname,'script.google.com');
 const getResponse=await fetch(endpoint,{signal:AbortSignal.timeout(45000)});assert.equal(getResponse.status,200);const getData=await getResponse.json();assert.equal(getData.ok,false);assert.equal(getData.error,'CalisTrack: authenticated POST required');
 for(const action of ['pull','push']){
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action}),signal:AbortSignal.timeout(45000)});
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.ok,false);assert.equal(data.error,'נדרשת כניסה ל־Google');assert.equal(data.records,undefined);
  console.log('PASS: anonymous '+action+' denied by Apps Script authentication.');
 }
 console.log('PASS: live backend responds and refuses anonymous data access. Authenticated workout write/read remains a separate integration check.');
}
