import {createHash} from 'node:crypto';
export function googleRequest(token){
 if(!token)throw Error('Google access-token Secret is missing.');
 return async (path,method='GET',body)=>{
  const url=path.startsWith('https://')?path:'https://script.googleapis.com/v1/'+path;
  const response=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  const data=await response.json();
  if(!response.ok){const reason=data.error?.details?.find(d=>d.reason)?.reason;const error=Error(`Google API HTTP ${response.status} ${data.error?.status||'REQUEST_FAILED'}${reason&&/^[A-Z_]+$/.test(reason)?' '+reason:''}`);error.status=response.status;throw error;}
  return data;
 };
}
async function createSafely(config,pendingKey,persist,create){
 if(config[pendingKey])throw Error('An earlier creation has an uncertain result. Recover its ID before retrying.');
 config[pendingKey]=true;await persist(config);
 try{return await create();}catch(error){if(error.status>=400&&error.status<500){config[pendingKey]=false;await persist(config);}throw error;}
}
export async function prepareProject({config,request,persist,source,manifest,clientId=''}){
 const identity=await request('https://www.googleapis.com/oauth2/v3/userinfo');
 if(identity.sub!==config.expectedGoogleSubject||identity.email_verified!==true||!identity.email)throw Error('The Google authorization belongs to a different account. Nothing was changed.');
 if(!config.scriptId){
  const project=await createSafely(config,'creationPending',persist,()=>request('projects','POST',{title:'CalisTrack',parentId:config.spreadsheetId}));
  if(!project.scriptId)throw Error('Google did not return a project ID; manual recovery is required.');
  config.scriptId=project.scriptId;config.createdByCalisTrack=true;config.creationPending=false;await persist(config);
 }
 if(!config.createdByCalisTrack)throw Error('Refusing to modify an Apps Script project not created by CalisTrack.');
 const project=await request('projects/'+encodeURIComponent(config.scriptId));
 if(project.parentId!==config.spreadsheetId||project.title!=='CalisTrack')throw Error('The project does not match the CalisTrack spreadsheet. Nothing was uploaded.');
 const routing={SPREADSHEET_ID:config.spreadsheetId,OWNER_EMAIL:identity.email,GOOGLE_CLIENT_ID:clientId};
 const content={files:[{name:'appsscript',type:'JSON',source:JSON.stringify(manifest)},{name:'Code',type:'SERVER_JS',source},{name:'DeploymentConfig',type:'SERVER_JS',source:'// Account routing only; no access tokens.\nconst CALISTRACK_CONFIG='+JSON.stringify(routing)+';'}]};
 await request('projects/'+encodeURIComponent(config.scriptId)+'/content','PUT',content);
 config.sourceDigest=createHash('sha256').update(JSON.stringify(content)).digest('hex');config.sourceUploaded=true;await persist(config);
 return {scriptId:config.scriptId,editorUrl:'https://script.google.com/home/projects/'+encodeURIComponent(config.scriptId)+'/edit',deployed:false};
}
export async function deployProject({config,request,persist}){
 if(!config.createdByCalisTrack||!config.sourceUploaded||!config.sourceDigest)throw Error('Verified CalisTrack source must be uploaded before deployment.');
 const base='projects/'+encodeURIComponent(config.scriptId);
 if(!config.versionNumber||config.versionDigest!==config.sourceDigest){const version=await request(base+'/versions','POST',{description:'CalisTrack authenticated backend'});if(!Number.isInteger(version.versionNumber))throw Error('Google did not return a version number.');config.versionNumber=version.versionNumber;config.versionDigest=config.sourceDigest;await persist(config);}
 const deploymentConfig={versionNumber:config.versionNumber,manifestFileName:'appsscript',description:'CalisTrack authenticated data endpoint'};
 let deployment;
 if(config.deploymentId)deployment=await request(base+'/deployments/'+encodeURIComponent(config.deploymentId),'PUT',{deploymentConfig});
 else deployment=await createSafely(config,'deploymentCreationPending',persist,()=>request(base+'/deployments','POST',deploymentConfig));
 if(!deployment.deploymentId)throw Error('Google did not return a deployment ID; recover it before retrying.');
 config.deploymentId=deployment.deploymentId;config.deploymentCreationPending=false;await persist(config);
 const url=deployment.entryPoints?.find(e=>e.entryPointType==='WEB_APP')?.webApp?.url;
 if(!url||!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url))throw Error('Deployment has no verified web-app URL.');
 config.backendUrl=url;await persist(config);return {deploymentId:config.deploymentId,backendUrl:url};
}
