import {newWorkout,uuid} from './core.js';
function requireCheck(condition,message){if(!condition)throw Error(message);}
function requireSuccess(data){requireCheck(data?.ok,data?.error||'שרת הענן לא אישר את הבקשה');return data;}
export async function cleanupDiagnostic(request,id){
 const pulled=requireSuccess(await request('pull'));const current=pulled.records.find(r=>r.id===id);
 if(!current)return;
 requireCheck(current.type==='workout'&&current.diagnostic===true&&id.startsWith('diagnostic-'),'רשומת השחזור אינה רשומת בדיקה');
 if(!current.deleted)requireSuccess(await request('push',{operation:{opId:uuid(),baseRevision:current.revision,record:{...current,deleted:true}}}));
 const checked=requireSuccess(await request('pull')).records.find(r=>r.id===id);
 requireCheck(checked?.deleted===true,'ניקוי אימון הבדיקה עדיין לא אושר בענן');
}
export async function verifyCloud(request,onRecovery=async()=>{}){
 const workout=newWorkout([]);workout.id='diagnostic-'+uuid();workout.diagnostic=true;workout.end=new Date().toISOString();workout.sets[0].actual=6;workout.sets[0].done=true;
 const operation={opId:uuid(),baseRevision:0,record:workout};
 for(const action of ['pull','push']){const denied=await request(action,action==='push'?{operation}:{},false);requireCheck(denied?.ok===false&&denied.error==='נדרשת כניסה ל־Google','השרת לא דחה גישה ללא כניסה כמצופה');}
 await onRecovery(workout.id);
 let failure=null,result;
 try{
  const first=requireSuccess(await request('push',{operation}));requireCheck(first.record.id===workout.id&&first.record.revision===1,'שמירת אימון הבדיקה לא אושרה');
  const repeated=requireSuccess(await request('push',{operation}));requireCheck(repeated.record.revision===first.record.revision,'ניסיון חוזר שינה את הגרסה');
  const records=requireSuccess(await request('pull')).records.filter(r=>r.id===workout.id);requireCheck(records.length===1,'נמצאה כפילות באימון הבדיקה');
  requireCheck(records[0].sets.length===5&&records[0].sets.filter(s=>s.done).length===1&&records[0].sets[0].actual===6,'נתוני האימון החלקי לא נטענו בדיוק');
  const corrected=structuredClone(first.record);corrected.sets[0].actual=7;
  const updated=requireSuccess(await request('push',{operation:{opId:uuid(),baseRevision:1,record:corrected}}));requireCheck(updated.record.revision===2,'תיקון האימון לא נשמר');
  const readback=requireSuccess(await request('pull')).records.find(r=>r.id===workout.id);requireCheck(readback?.sets[0].actual===7&&readback.revision===2,'התיקון לא נטען מחדש');
  const stale=await request('push',{operation:{...operation,opId:uuid()}});requireCheck(stale?.ok===false&&stale.conflict?.revision===2,'עדכון ישן לא נדחה כמצופה');
  result={version:1,verifiedAt:new Date().toISOString(),testWorkoutId:workout.id,checks:['anonymous_denied','workout_saved','partial_read_exact','retry_idempotent','correction_readback','stale_revision_denied','soft_delete_verified']};
 }catch(error){failure=error;}
 try{await cleanupDiagnostic(request,workout.id);await onRecovery(null);}catch(error){throw Error((failure?failure.message+' · ':'')+'ניקוי רשומת הבדיקה ממתין לחיבור: '+error.message);}
 if(failure)throw failure;return result;
}
