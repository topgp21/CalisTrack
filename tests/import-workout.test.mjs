import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseWorkoutText,importErrors,buildImportedWorkout,validDate} from '../public/import-workout.js';
import {acknowledge,mergeRemote,csv} from '../public/core.js';
import {summary} from './fixtures/workout-summary.mjs';
// Fixtures remain in memory. No production network, Sheets or user database access.
test('Hebrew November 9 summary parses ten actual sets, date, units and difficulty',async()=>{
 const d=parseWorkoutText(summary);assert.equal(d.date,'2026-11-09');assert.deepEqual(d.unresolved,[]);assert.equal(d.warmup,3);assert.equal(d.cooldown,2);assert.equal(d.sets.length,10);assert.deepEqual(importErrors(d),[]);
 assert.deepEqual(d.sets.map(s=>[s.exercise,s.index,s.actual,s.difficulty]),[['pushup',1,8,'בינוני'],['pushup',2,8,'בינוני'],['squat',1,15,'קל'],['squat',2,15,'בינוני'],['row',1,12,'קל'],['row',2,12,'קל'],['bridge',1,15,'קל'],['bridge',2,15,'בינוני'],['plank',1,30,'בינוני'],['plank',2,30,'קשה']]);
 const r=await buildImportedWorkout(d,summary,{},new Date('2026-11-15T12:00Z'));assert.equal(r.workoutDate,'2026-11-09');assert.equal(r.timeUnknown,true);assert.equal(r.week,null);assert.equal(r.sets.every(s=>s.done),true);assert.equal(new Set(r.sets.map(s=>s.id)).size,10);assert.ok(r.sets.every(s=>s.target==='לא דווח'));assert.match(csv([r]),/time_reported/);assert.ok(!csv([r]).includes('T00:00:00'));
});
test('missing date, result, difficulty and ambiguous units require correction',()=>{
 for(const input of ['שכיבות סמיכה: 8 בינוני','9.11.2026; שכיבות סמיכה: בינוני','9.11.2026; שכיבות סמיכה: 8','9.11.2026; פלאנק: 30 חזרות קשה','9.11.2026; שכיבות סמיכה: 8–10 בינוני'])assert.ok(importErrors(parseWorkoutText(input)).length,input);
 assert.equal(validDate('2026-02-30'),false);assert.equal(parseWorkoutText('9.11.2026; 10.11.2026; שכיבות סמיכה: 8 קל').date,'');
});
test('explicit set numbers, markdown and unknown exercise are not silently lost',()=>{
 const d=parseWorkoutText('תאריך: 09/11/2026\n**שכיבות סמיכה:** סט 2: 8 חזרות בינוני, סט 1: 7 חזרות קשה\nבורפי: 10 קל');assert.equal(d.sets[0].index,2);assert.equal(d.sets[1].index,1);assert.ok(d.unresolved.some(s=>s.includes('בורפי')));assert.ok(importErrors(d).length);
 d.unresolved=[];assert.deepEqual(importErrors(d),[]);d.sets[1].index=2;assert.ok(importErrors(d).length);
});
test('preview corrections are applied, old records unchanged, repeats and tombstones blocked',async()=>{
 const d=parseWorkoutText(summary),original=await buildImportedWorkout(d,summary),before=JSON.stringify(original);
 await assert.rejects(buildImportedWorkout(d,summary,{[original.id]:original}),/כבר/);
 await assert.rejects(buildImportedWorkout(d,summary,{[original.id]:{...original,deleted:true}}),/כבר/);
 d.date='2026-11-08';d.sets[0].actual=7;d.sets[0].difficulty='קשה';const corrected=await buildImportedWorkout(d,summary);assert.equal(corrected.sets[0].actual,7);assert.equal(corrected.workoutDate,'2026-11-08');assert.equal(JSON.stringify(original),before);
 await assert.rejects(buildImportedWorkout(parseWorkoutText(summary),summary,{[corrected.id]:corrected}),/כבר/);
 const normal={...original,id:'existing',source:undefined,importFingerprint:undefined,importSourceFingerprint:undefined};await assert.rejects(buildImportedWorkout(parseWorkoutText(summary),summary,{existing:normal}),/זהה/);
});
test('stable content IDs across formatting, past dates, serialized queue and remote acknowledgment',async()=>{
 const d=parseWorkoutText(summary);const a=await buildImportedWorkout(d,summary),b=await buildImportedWorkout(d,summary.replaceAll(';','\n'));assert.equal(a.id,b.id);
 const state=JSON.parse(JSON.stringify({records:{[a.id]:a},queue:[{opId:'import-operation',baseRevision:0,record:a}]}));mergeRemote(state,[{...a,revision:1}]);assert.equal(state.queue.length,1);assert.equal(state.records[a.id].revision,0);acknowledge(state,state.queue[0],{...a,revision:1});assert.equal(state.queue.length,0);assert.equal(state.records[a.id].revision,1);assert.deepEqual(state.records[a.id].sets,a.sets);
});

import {lineSummary} from './fixtures/workout-summary.mjs';
import {recognitionCounts} from '../public/import-workout.js';
test('ten Hebrew exercise-name set-number lines parse exactly like the compact November 9 summary',async()=>{
 const d=parseWorkoutText(lineSummary);assert.deepEqual(d.sets,parseWorkoutText(summary).sets);assert.equal(d.date,'2026-11-09');assert.equal(d.warmup,3);assert.equal(d.cooldown,2);assert.deepEqual(d.unresolved,[]);assert.deepEqual(recognitionCounts(d),{recognized:10,total:10});assert.deepEqual(importErrors(d),[]);
 const r=await buildImportedWorkout(d,lineSummary);assert.equal(r.importedText,lineSummary);assert.equal(r.sets.length,10);
});
test('difficulty comma never creates a phantom set, including colon before explicit set number',()=>{
 for(const text of ['שכיבות סמיכה סט 1: 8 חזרות, קושי בינוני','שכיבות סמיכה: סט 1: 8 חזרות, קושי בינוני','• **פלאנק סט 2:** 30 שניות, רמת קושי קשה']){const d=parseWorkoutText('9.11.2026\n'+text);assert.equal(d.sets.length,1);assert.equal(d.unresolved.length,0);assert.equal(d.sets[0].difficulty,text.includes('קשה')?'קשה':'בינוני');assert.deepEqual(importErrors(d),[]);}
});
test('one unparsed set blocks the entire import and retains its source line',async()=>{
 const raw=lineSummary.replace('פלאנק סט 2: 30 שניות, קושי קשה','פלאנק סט 2: לא זוכר שניות, קושי קשה');const d=parseWorkoutText(raw);assert.equal(d.sets.length,9);assert.equal(d.unresolved.length,1);assert.match(d.unresolved[0],/לא זוכר/);assert.deepEqual(recognitionCounts(d),{recognized:9,total:10});await assert.rejects(buildImportedWorkout(d,raw),/שלא פוענח/);
});
test('missing difficulty, invalid unit and duplicate explicit set index are never recognized as complete',()=>{
 for(const replacement of ['פלאנק סט 2: 30 שניות','פלאנק סט 2: 30 חזרות, קושי קשה','פלאנק סט 1: 30 שניות, קושי קשה']){const d=parseWorkoutText(lineSummary.replace('פלאנק סט 2: 30 שניות, קושי קשה',replacement));assert.ok(importErrors(d).length);assert.ok(recognitionCounts(d).recognized<10);}
});
