/** Cloud-only deploy helper. Access token must come from a Secret, never CLI arguments. */
import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url),stateURL=new URL('.calistrack/deployment.json',root);
const state=JSON.parse(await fs.readFile(stateURL,'utf8'));
const accessToken=process.env.CALISTRACK_GOOGLE_ACCESS_TOKEN;
const clientId=process.env.CALISTRACK_GOOGLE_CLIENT_ID||state.googleClientId;
const ownerEmail=process.env.CALISTRACK_OWNER_EMAIL||state.ownerEmail;
if(!accessToken)throw Error('Apps Script deployment blocked: Google access token Secret is not configured.');
if(!clientId?.endsWith('.apps.googleusercontent.com')||!ownerEmail)throw Error('Missing verified owner email or public Google client ID.');
async function save(){await fs.writeFile(new URL('.calistrack/deployment.json.tmp',root),JSON.stringify(state,null,2));await fs.rename(new URL('.calistrack/deployment.json.tmp',root),stateURL);}
async function request(url,method='GET',body){
 const res=await fetch(url,{method,headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 const result=await res.json();if(!res.ok)throw Error(`Google API HTTP ${res.status}: ${result.error?.status||'REQUEST_FAILED'}`);return result;
}
const identity=await request('https://www.googleapis.com/oauth2/v3/userinfo');
if(identity.email?.toLowerCase()!==ownerEmail.toLowerCase()||identity.email_verified!==true)throw Error('Deployment identity is not the configured owner.');
if(!state.scriptId){const created=await request('https://script.googleapis.com/v1/projects','POST',{title:'CalisTrack',parentId:state.spreadsheetId});state.scriptId=created.scriptId;state.scriptCreatedByCalisTrack=true;await save();}
if(!state.scriptCreatedByCalisTrack)throw Error('Refusing to modify an Apps Script project not created by this helper.');
const manifest=JSON.parse(await fs.readFile(new URL('server/appsscript.json',root),'utf8'));
manifest.webapp={access:'ANYONE_ANONYMOUS',executeAs:'USER_DEPLOYING'};
const source=await fs.readFile(new URL('server/Code.gs',root),'utf8');
const config={SPREADSHEET_ID:state.spreadsheetId,GOOGLE_CLIENT_ID:clientId,OWNER_EMAIL:ownerEmail};
await request(`https://script.googleapis.com/v1/projects/${state.scriptId}/content`,'PUT',{files:[{name:'appsscript',type:'JSON',source:JSON.stringify(manifest)},{name:'Code',type:'SERVER_JS',source},{name:'DeploymentConfig',type:'SERVER_JS',source:`// Non-secret account routing. All data requests still require Google ID-token verification.\nconst CALISTRACK_CONFIG=${JSON.stringify(config)};`}]});
const version=await request(`https://script.googleapis.com/v1/projects/${state.scriptId}/versions`,'POST',{description:'CalisTrack authenticated backend'});
const deploymentConfig={versionNumber:version.versionNumber,manifestFileName:'appsscript',description:'CalisTrack'};
const deployed=await request(`https://script.googleapis.com/v1/projects/${state.scriptId}/deployments${state.deploymentId?'/'+state.deploymentId:''}`,state.deploymentId?'PUT':'POST',state.deploymentId?{deploymentConfig}:deploymentConfig);
state.deploymentId=deployed.deploymentId;state.googleClientId=clientId;
state.backendUrl=deployed.entryPoints?.find(e=>e.entryPointType==='WEB_APP')?.webApp?.url||state.backendUrl;
await save();
if(!state.backendUrl)throw Error('Deployment returned no web-app URL; inspect the saved deployment ID.');
await fs.writeFile(new URL('public/deployment-config.js',root),`// Public configuration. No credentials.\nexport const deploymentConfig=${JSON.stringify({url:state.backendUrl,clientId})};\n`);
console.log(JSON.stringify({scriptId:state.scriptId,backendUrl:state.backendUrl,verified:false,next:'Owner consent and live integration checks remain required.'}));
