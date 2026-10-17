export function googleRequest(token){
 if(!token)throw Error('Google access-token Secret is missing.');
 return async (path,method='GET',body)=>{
  const url=path.startsWith('https://')?path:'https://script.googleapis.com/v1/'+path;
  const response=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  const data=await response.json();
  if(!response.ok){const reason=data.error?.details?.find(d=>d.reason)?.reason;throw Error(`Google API HTTP ${response.status} ${data.error?.status||'REQUEST_FAILED'}${reason&&/^[A-Z_]+$/.test(reason)?' '+reason:''}`);}
  return data;
 };
}
export async function prepareProject({config,request,persist,source,manifest,clientId=''}){
 const identity=await request('https://www.googleapis.com/oauth2/v3/userinfo');
 if(identity.sub!==config.expectedGoogleSubject||identity.email_verified!==true||!identity.email)throw Error('The Google authorization belongs to a different account. Nothing was changed.');
 if(!config.scriptId){
  if(config.creationPending)throw Error('An earlier project creation has an uncertain result. Recover its ID before retrying.');
  config.creationPending=true;await persist(config);
  const project=await request('projects','POST',{title:'CalisTrack',parentId:config.spreadsheetId});
  if(!project.scriptId)throw Error('Google did not return a project ID; manual recovery is required.');
  config.scriptId=project.scriptId;config.createdByCalisTrack=true;config.creationPending=false;await persist(config);
 }
 if(!config.createdByCalisTrack)throw Error('Refusing to modify an Apps Script project not created by CalisTrack.');
 const project=await request('projects/'+encodeURIComponent(config.scriptId));
 if(project.parentId!==config.spreadsheetId||project.title!=='CalisTrack')throw Error('The project does not match the CalisTrack spreadsheet. Nothing was uploaded.');
 const routing={SPREADSHEET_ID:config.spreadsheetId,OWNER_EMAIL:identity.email,GOOGLE_CLIENT_ID:clientId};
 await request('projects/'+encodeURIComponent(config.scriptId)+'/content','PUT',{files:[{name:'appsscript',type:'JSON',source:JSON.stringify(manifest)},{name:'Code',type:'SERVER_JS',source},{name:'DeploymentConfig',type:'SERVER_JS',source:'// Account routing only; no access tokens.\nconst CALISTRACK_CONFIG='+JSON.stringify(routing)+';'}]});
 config.sourceUploaded=true;await persist(config);
 return {scriptId:config.scriptId,editorUrl:'https://script.google.com/home/projects/'+encodeURIComponent(config.scriptId)+'/edit',deployed:false};
}
