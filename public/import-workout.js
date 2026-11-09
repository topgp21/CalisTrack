import {exercises,validate} from './core.js';
const aliases={pushup:['שכיבות סמיכה'],squat:['סקוואט לכיסא','סקוואט'],row:['חתירה עם תיק גב','חתירה עם תיק'],bridge:['גשר ישבן'],plank:['פלאנק']};
export function validDate(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===v;}
export function parseWorkoutText(raw){
 const text=raw.normalize('NFKC').replace(/[\u200e\u200f]/g,'').replace(/[*#]/g,'');
 const dates=[...text.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b|\b(\d{4}-\d{2}-\d{2})\b/g)].map(m=>m[4]||`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
 const draft={date:new Set(dates).size===1&&validDate(dates[0])?dates[0]:'',warmup:'',cooldown:'',sets:[],unresolved:[]};
 const body=text.replace(/\b\d{1,2}[./]\d{1,2}[./]\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/g,'').replace(/^(?:סיכום\s+)?ה?אימון(?:\s+שלי)?\s*(?:מ[־-]?)?\s*:?\s*/,'');
 for(let line of body.split(/[;\n]+/).map(s=>s.trim()).filter(Boolean)){
  line=line.replace(/^[-•]\s*/,'');
  if(/^(?:סיכום\s+)?ה?אימון(?:\s+שלי)?\s*(?:מ[־-]?)?\s*:?$|^תאריך\s*:?$/.test(line))continue;
  const duration=line.match(/^(חימום|שחרור)\s*:?\s*(\d+)\s*דקות?\s*[.]?$/);
  if(duration){const key=duration[1]==='חימום'?'warmup':'cooldown';if(draft[key]!=='')draft.unresolved.push(line);else draft[key]=Number(duration[2]);continue;}
  let match;
  for(const [id,names]of Object.entries(aliases))for(const name of names){if(line.startsWith(name)&&/^\s*[:־-]/.test(line.slice(name.length))){match={id,rest:line.slice(name.length).replace(/^\s*[:־-]\s*/,'')};break;}if(match)break;}
  if(!match){draft.unresolved.push(line);continue;}
  for(const part of match.rest.split(/[,،]+/)){
   const m=part.trim().match(/^(?:סט\s*(\d+)\s*[:־-]\s*)?(\d+)?\s*(שניות|שנייה|חזרות)?\s*(קל|בינוני|קשה)?\s*[.]?$/);
   const count=draft.sets.filter(s=>s.exercise===match.id).length;
   const s={exercise:match.id,index:m?.[1]?Number(m[1]):count+1,actual:m?.[2]?Number(m[2]):'',unit:match.id==='plank'?'seconds':'reps',difficulty:m?.[4]||''};
   if(!m||(m[3]&&((match.id==='plank')!==/^שני/.test(m[3]))))draft.unresolved.push(part.trim());
   draft.sets.push(s);
  }
 }
 return draft;
}
export function importErrors(d){const errors=[];if(!validDate(d.date))errors.push('יש להזין תאריך אימון מלא ותקין');if(!d.sets.length||d.sets.length>100)errors.push('יש להזין בין סט אחד ל־100 סטים');if(d.unresolved.some(s=>s.trim()))errors.push('יש לתקן או להסיר במפורש את הטקסט שלא פוענח');for(const key of ['warmup','cooldown'])if(d[key]!==''&&(!Number.isInteger(Number(d[key]))||Number(d[key])<0||Number(d[key])>120))errors.push('משך חימום ושחרור חייב להיות 0–120 דקות');const seen=new Set();for(const s of d.sets){const key=s.exercise+':'+s.index;if(!exercises.some(e=>e.id===s.exercise)||!Number.isInteger(Number(s.index))||s.index<1||s.index>100||seen.has(key)||!Number.isInteger(Number(s.actual))||s.actual===''||s.actual<1||s.actual>10000||!s.difficulty.trim()||s.difficulty.length>60||s.unit!==(s.exercise==='plank'?'seconds':'reps'))errors.push('יש לתקן תרגיל, מספר סט ייחודי, תוצאה חיובית, יחידה ורמת קושי בכל סט');seen.add(key);}return [...new Set(errors)];}
const canonical=d=>JSON.stringify([d.date,[...d.sets].map(s=>[s.exercise,Number(s.index),Number(s.actual),s.difficulty.trim()]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))||a[1]-b[1])]);
export async function buildImportedWorkout(d,sourceText,records={},now=new Date()){
 const errors=importErrors(d);if(errors.length)throw Error(errors.join('. '));
 const key=canonical(d),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const sourceFingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sourceText.normalize('NFKC').replace(/\s+/g,' ').trim())))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const id='import-'+hash;
 for(const r of Object.values(records)){
  if(r.id===id||r.importFingerprint===hash||r.importSourceFingerprint===sourceFingerprint)throw Error('האימון כבר יובא, או נמחק בעבר. לא נוצר עותק נוסף');
  if(r.type==='workout'&&!r.diagnostic&&!r.deleted){const day=r.workoutDate||new Date(r.start).toLocaleDateString('en-CA');const sets=r.sets.filter(s=>s.done);if(canonical({date:day,sets})===key)throw Error('אימון זהה כבר קיים בהיסטוריה');}
 }
 // Existing schema requires timestamps. Midnight is a date anchor, never a reported time.
 const anchor=new Date(d.date+'T00:00:00').toISOString();
 const record=validate({id,type:'workout',start:anchor,end:anchor,workoutDate:d.date,timeUnknown:true,week:null,revision:0,updatedAt:now.toISOString(),source:'chatgpt-import',importFingerprint:hash,importSourceFingerprint:sourceFingerprint,importedText:sourceText,warmupMinutes:d.warmup===''?null:Number(d.warmup),cooldownMinutes:d.cooldown===''?null:Number(d.cooldown),sets:d.sets.map(s=>({id:id+'-'+s.exercise+'-'+Number(s.index),exercise:s.exercise,index:Number(s.index),actual:Number(s.actual),done:true,target:'לא דווח',difficulty:s.difficulty.trim()}))});
 if(JSON.stringify(record).length>45000)throw Error('סיכום האימון גדול מדי. קצר את הטקסט ונסה שוב');
 return record;
}
