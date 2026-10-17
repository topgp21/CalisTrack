/** Real HTTPS smoke check. This does not execute a browser or verify cloud workout storage. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin=new URL(process.argv[2]);assert.equal(origin.protocol,'https:');
const shell=['index.html','app.js','core.js','store.js','deployment-config.js','style.css','sw.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png'];
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
