/** CalisTrack: deploy as owner / Anyone. ALL reads and writes require verified Google ID token. */
function doPost(e) {
  try {
    if (!e || !e.postData || e.postData.contents.length > 250000) throw Error('בקשה לא תקינה');
    var body=JSON.parse(e.postData.contents); authenticate_(body.token);
    var lock=LockService.getScriptLock();if(!lock.tryLock(25000))throw Error('השרת עסוק; נסה שוב');
    try {
      var db=SpreadsheetApp.openById(required_('SPREADSHEET_ID'));
      var journal=sheet_(db,'Operations',['opId','recordId','revision','updatedAt','json']);
      var events=journal.getLastRow()>1?journal.getRange(2,1,journal.getLastRow()-1,5).getValues():[];
      var records=Object.create(null),ops=Object.create(null);events.forEach(function(row){if(!row[0])return;var record=JSON.parse(row[4]);records[record.id]=record;ops[row[0]]=record;});
      var result;
      if(body.action==='pull')result={ok:true,records:Object.keys(records).map(function(k){return records[k];})};
      else if(body.action==='push'){
        var op=body.operation;if(!op||typeof op.opId!=='string'||!/^[A-Za-z0-9][\w-]{0,99}$/.test(op.opId)||!Number.isSafeInteger(op.baseRevision)||op.baseRevision<0)throw Error('מזהה פעולה לא תקין');
        if(ops[op.opId])result={ok:true,record:ops[op.opId]};
        else {
          var r=op.record; validateRecord_(r);
          var current=records[r.id];
          if((current?current.revision:0)!==op.baseRevision)return json_({ok:false,error:'התנגשות גרסאות: נדרשת בחירה ידנית בהגדרות',conflict:current});
          r.revision=(current?current.revision:0)+1;r.updatedAt=new Date().toISOString();
          journal.appendRow([op.opId,r.id,r.revision,r.updatedAt,JSON.stringify(r)]);
          SpreadsheetApp.flush(); // journal is the durable commit; projections can always be rebuilt
          records[r.id]=r;result={ok:true,record:r};
        }
      }else throw Error('פעולה לא נתמכת');
      project_(db,records);return json_(result);
    }finally{lock.releaseLock();}
  }catch(err){return json_({ok:false,error:String(err.message||err)});}
}
function doGet(){return json_({ok:false,error:'CalisTrack: authenticated POST required'});}
function required_(key){var v=PropertiesService.getScriptProperties().getProperty(key);if(!v&&typeof CALISTRACK_CONFIG!=='undefined')v=CALISTRACK_CONFIG[key];if(!v)throw Error('חסרה הגדרת שרת: '+key);return v;}
function authenticate_(token){
  if(typeof token!=='string'||token.length>10000)throw Error('נדרשת כניסה ל־Google');
  var response=UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(token),{muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw Error('הכניסה פגה; יש להיכנס מחדש');
  var claims=JSON.parse(response.getContentText());
  if(claims.aud!==required_('GOOGLE_CLIENT_ID')||['accounts.google.com','https://accounts.google.com'].indexOf(claims.iss)<0||(!Number.isFinite(Number(claims.exp))||Number(claims.exp)*1000<=Date.now())||String(claims.email_verified)!=='true'||String(claims.email).toLowerCase()!==required_('OWNER_EMAIL').toLowerCase())throw Error('החשבון אינו מורשה');
}
function validateRecord_(r){
  if(!r||typeof r.id!=='string'||!/^[\w-]{1,100}$/.test(r.id)||['workout','measurement'].indexOf(r.type)<0)throw Error('רשומה לא תקינה');
  if(r.deleted!==undefined&&typeof r.deleted!=='boolean')throw Error('מחיקה לא תקינה');
  if(r.type==='measurement'){if(!isFinite(Date.parse(r.date))||typeof r.weight!=='number'||!(r.weight>0&&r.weight<500)||r.waist!==null&&!(typeof r.waist==='number'&&r.waist>0&&r.waist<400))throw Error('מדידה לא תקינה');}
  else {
    if(!isFinite(Date.parse(r.start))||!isFinite(Date.parse(r.end))||Date.parse(r.end)<Date.parse(r.start)||!Array.isArray(r.sets)||r.sets.length>100)throw Error('אימון לא תקין');
    var ids=Object.create(null);r.sets.forEach(function(s){if(typeof s.id!=='string'||!/^[\w-]{1,100}$/.test(s.id)||ids[s.id]||['pushup','squat','row','bridge','plank'].indexOf(s.exercise)<0||typeof s.done!=='boolean'||s.actual!==null&&!(typeof s.actual==='number'&&isFinite(s.actual)&&s.actual>=0&&s.actual<=10000)||s.done&&!(s.actual>0)||typeof s.target!=='string'||s.target.length>40||typeof s.difficulty!=='string'||s.difficulty.length>60)throw Error('סט לא תקין');ids[s.id]=true;});
  }
  if(JSON.stringify(r).length>45000)throw Error('רשומה גדולה מדי');
}
function sheet_(db,name,headers){var s=db.getSheetByName(name)||db.insertSheet(name);if(!s.getLastRow()){s.appendRow(headers);s.setFrozenRows(1);}return s;}
function safe_(v){return typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:v;}
function replace_(db,name,headers,rows){var s=sheet_(db,name,headers);s.clearContents();s.getRange(1,1,1,headers.length).setValues([headers]);if(rows.length)s.getRange(2,1,rows.length,headers.length).setValues(rows.map(function(row){return row.map(safe_);}));}
function project_(db,records){var workouts=[],sets=[],measurements=[];Object.keys(records).forEach(function(id){var r=records[id];if(r.type==='workout'){workouts.push([r.id,r.start,r.end,r.week||1,r.revision,r.updatedAt,!!r.deleted]);r.sets.forEach(function(s){sets.push([s.id,r.id,s.exercise,s.index,s.target,s.difficulty,s.actual===null?'':s.actual,s.done,r.revision,r.updatedAt,!!r.deleted]);});}else measurements.push([r.id,r.date,r.weight,r.waist===null?'':r.waist,'reported',r.revision,r.updatedAt,!!r.deleted]);});replace_(db,'Workouts',['id','start','end','week','revision','updatedAt','deleted'],workouts);replace_(db,'Sets',['id','workoutId','exerciseId','index','target','difficulty','actual','done','revision','updatedAt','deleted'],sets);replace_(db,'Measurements',['id','date','weight','waist','source','revision','updatedAt','deleted'],measurements);replace_(db,'Exercises',['id','name','unit'],[['pushup','שכיבות סמיכה','reps'],['squat','סקוואט לכיסא','reps'],['row','חתירה עם תיק גב','reps'],['bridge','גשר ישבן','reps'],['plank','פלאנק','seconds']]);}
function json_(v){return ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON);}
/** Owner runs this once from the editor to consent. It does not write workout data. */
function authorizeCalisTrack(){
 if(Session.getEffectiveUser().getEmail().toLowerCase()!==required_('OWNER_EMAIL').toLowerCase())throw Error('החשבון אינו מורשה');
 SpreadsheetApp.openById(required_('SPREADSHEET_ID')).getId();
 UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo',{muteHttpExceptions:true});
 console.log('CalisTrack: הרשאות הגיליון והרשת נבדקו. עדיין נדרשים OAuth ופריסה.');
}
