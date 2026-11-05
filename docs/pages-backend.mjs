import{newState,apply,ensureDays,calculate,evaluation,validDate}from'./domain.mjs';
// This adapter is used only by the explicitly labelled, browser-only Pages edition.
// Production server storage and authentication remain in server.mjs.
const NAME='100-days-challenge-pages-data-v1';let connection;
function open(){return connection??=new Promise((resolve,reject)=>{const r=indexedDB.open(NAME,1);r.onupgradeneeded=()=>r.result.createObjectStore('records');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function get(key){const db=await open();return new Promise((resolve,reject)=>{const r=db.transaction('records').objectStore('records').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function put(key,value){const db=await open();return new Promise((resolve,reject)=>{const t=db.transaction('records','readwrite');t.objectStore('records').put(value,key);t.oncomplete=()=>resolve(value);t.onerror=()=>reject(t.error);});}
function error(message,status=400){return Object.assign(new Error(message),{status});}
async function change(fn,operationId){const db=await open();return new Promise((resolve,reject)=>{const t=db.transaction('records','readwrite'),records=t.objectStore('records');let result,failure;const request=records.get('state');request.onsuccess=()=>{const state=request.result??newState();const execute=seen=>{try{if(!seen){fn(state);records.put(state,'state');if(operationId)records.put(true,'operation:'+operationId);}result=state;}catch(e){failure=e;t.abort();}};if(operationId){const seen=records.get('operation:'+operationId);seen.onsuccess=()=>execute(seen.result);}else execute(false);};t.oncomplete=()=>resolve(result);t.onabort=()=>reject(failure??t.error??error('Не удалось сохранить в браузере'));t.onerror=()=>{failure??=t.error;};});}
export function createBrowserApi(){return async(path,options={})=>{
 const body=options.body?JSON.parse(options.body):{};
 if(path==='/api/config')return{authReady:false,trialReady:true,pagesReady:true,pushReady:false};
 if(path==='/api/trial'){await put('open',true);return{ok:true};}
 if(!await get('open'))throw error('Откройте дневник',401);
 if(path==='/api/me'){const state=await change(s=>{const before=JSON.stringify(s);ensureDays(s);if(before!==JSON.stringify(s))s.revision++;});return{id:'pages-local',email:'local@device.invalid',state};}
 if(path==='/api/sync'){if(typeof body.id!=='string'||body.id.length>100)throw error('Не указан ID записи');const state=await change(s=>{if(body.baseRevision!==s.revision)throw error('Записи изменились в другой вкладке. Сравните изменения перед сохранением.',409);apply(s,body.action);s.revision++;},body.id);return{state};}
 if(path==='/api/calculate')return calculate(body.profile);
 if(path==='/api/logout'){await put('open',false);return{ok:true};}
 if(path==='/api/photos'&&options.method==='POST'){
  if(!validDate(body.date)||!['image/jpeg','image/png','image/webp'].includes(body.mime)||typeof body.base64!=='string'||body.base64.length>6666668)throw error('Проверьте фото и дату. Максимум 5 МБ.');
  let bytes;try{bytes=Uint8Array.from(atob(body.base64),c=>c.charCodeAt(0));}catch{throw error('Не удалось прочитать фото');}
  const valid=body.mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:body.mime==='image/png'?bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10':String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';if(!valid||bytes.length>5e6)throw error('Формат фото не совпадает с файлом');
  const state=await change(s=>{s.photos.push({id:crypto.randomUUID(),date:body.date,mime:body.mime,dataURL:'data:'+body.mime+';base64,'+body.base64,created:Date.now()});s.revision++;});return{state};
 }
 if(path==='/api/account'&&options.method==='DELETE'){if(body.confirm!=='УДАЛИТЬ')throw error('Введите слово УДАЛИТЬ');const db=await open();await new Promise((resolve,reject)=>{const t=db.transaction('records','readwrite');t.objectStore('records').clear();t.oncomplete=resolve;t.onerror=()=>reject(t.error);});return{ok:true};}
 throw error('Эта функция требует серверной версии приложения',503);
};}
export function browserCSV(s){const rows=[['type','date','timezone','stage','calories','protein','fat','carbs','sugar','water','steps','calorie_goal','protein_goal','water_goal','steps_goal','workout','percent','credited','weight','waist','hips','chest','abdomen','leg','note']];for(const d of s.days)rows.push(['day',d.date,d.timezone,d.stage,...['calories','protein','fat','carbs','sugar','water','steps'].map(k=>d.values[k]??''),d.goal.calories??'',d.goal.protein??'',d.water,d.steps,d.workout?d.workoutResult??'missing':'rest',evaluation(d).percent,d.credited,'','','','','','',d.note]);for(const b of s.body)rows.push(['body',b.date,...Array(16).fill(''),b.weight??'',...['waist','hips','chest','abdomen','leg'].map(k=>b.measurements[k]??''),'']);const esc=v=>'"'+String(v).replace(/^[=+\-@\t\r]/,"'"+'$&').replaceAll('"','""')+'"';return '\ufeff'+rows.map(r=>r.map(esc).join(',')).join('\r\n');}
export async function downloadBrowserExport(format){const s=await get('state');if(!s)throw error('Пока нет сохранённых данных');let data,type,name;
 if(format==='csv'){data=browserCSV(s);type='text/csv;charset=utf-8';name='100-days.csv';}
 else if(format==='photos'){const pieces=[];for(const p of s.photos){if(!p.dataURL)continue;const bytes=Uint8Array.from(atob(p.dataURL.split(',')[1]),c=>c.charCodeAt(0)),h=new Uint8Array(512),encoder=new TextEncoder(),set=(str,offset)=>h.set(encoder.encode(str),offset);set(p.date+'-'+p.id+'.'+p.mime.split('/')[1],0);set('0000600\0',100);set('0000000\0',108);set('0000000\0',116);set(bytes.length.toString(8).padStart(11,'0')+'\0',124);set(Math.floor(p.created/1000).toString(8).padStart(11,'0')+'\0',136);h.fill(32,148,156);h[156]=48;set('ustar\0',257);set('00',263);set(h.reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148);pieces.push(h,bytes,new Uint8Array((512-bytes.length%512)%512));}pieces.push(new Uint8Array(1024));data=new Blob(pieces);type='application/x-tar';name='progress-photos.tar';}
 else{const exported={...s};delete exported.subscriptions;data=JSON.stringify({version:1,edition:'github-pages-browser-only',exportedAt:new Date().toISOString(),...exported},null,2);type='application/json';name='100-days-history.json';}
 const blob=new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
