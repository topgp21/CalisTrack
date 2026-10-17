/** Run only against the CalisTrack backend. ID token comes from a runtime Secret. */
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {newWorkout,uuid} from '../public/core.js';
const state=JSON.parse(await fs.readFile(new URL('../.calistrack/deployment.json',import.meta.url),'utf8'));
const token=process.env.CALISTRACK_GOOGLE_ID_TOKEN;
if(!state.backendUrl||!token)throw Error('Integration BLOCKED: deployed URL and owner Google ID-token Secret are required.');
async function call(body){const res=await fetch(state.backendUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});return res.json();}
assert.equal((await call({action:'pull'})).ok,false,'Anonymous reads must fail');
const w=newWorkout([]);w.end=new Date().toISOString();w.sets[0].done=true;w.sets[0].actual=6;
const op={opId:uuid(),baseRevision:0,record:w};
assert.equal((await call({action:'push',operation:op})).ok,false,'Anonymous writes must fail');
const first=await call({token,action:'push',operation:op});assert.equal(first.ok,true,first.error);
try{
 const repeat=await call({token,action:'push',operation:op});assert.equal(repeat.ok,true,repeat.error);assert.equal(repeat.record.revision,first.record.revision,'Retry must be idempotent');
 const pulled=await call({token,action:'pull'});assert.equal(pulled.ok,true,pulled.error);assert.equal(pulled.records.filter(r=>r.id===w.id).length,1);const saved=pulled.records.find(r=>r.id===w.id);assert.equal(saved.sets.filter(s=>s.done).length,1);assert.equal(saved.sets[0].actual,6);
 const stale=await call({token,action:'push',operation:{...op,opId:uuid()}});assert.equal(stale.ok,false,'Stale update must fail');
 state.integrationVerified=true;state.integrationVerifiedAt=new Date().toISOString();
 await fs.writeFile(new URL('../.calistrack/deployment.json',import.meta.url),JSON.stringify(state,null,2));
 console.log('PASS: real workout write/read, idempotency, partial sets, anonymous access denial, revision conflict.');
}finally{
 const cleanup=await call({token,action:'push',operation:{opId:uuid(),baseRevision:first.record.revision,record:{...first.record,deleted:true}}});
 if(!cleanup.ok)throw Error('Integration record cleanup failed; record ID: '+w.id);
 console.log('Test workout soft-deleted; journal preserved. Test record ID: '+w.id);
}
