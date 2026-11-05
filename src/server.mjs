import http from 'node:http';
import { randomBytes, randomInt, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { apply, ensureDays, calculate, current, evaluation, dateAt, fail } from './domain.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'), pub=join(root,'public');
const port=Number(process.env.PORT??8787),host=process.env.HOST??'127.0.0.1',origin=process.env.APP_ORIGIN??`http://localhost:${port}`;
const trial=process.env.LOCAL_TRIAL==='1';
if(trial&&(process.env.NODE_ENV==='production'||host!=='127.0.0.1'||!['http://localhost:'+port,'http://127.0.0.1:'+port].includes(origin)))throw new Error('Local trial requires non-production mode and loopback-only HTTP binding');
const dataDir=resolve(process.env.DATA_DIR??join(root,'data')), photosDir=join(dataDir,'photos');await mkdir(photosDir,{recursive:true});
const store=openStore(dataDir),{db}=store;
const hash=s=>createHash('sha256').update(s).digest('hex');
const authReady=!!(process.env.RESEND_API_KEY&&process.env.EMAIL_FROM&&process.env.AUTH_SECRET?.length>=32);
let push=null; try{push=(await import('web-push')).default;if(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY&&process.env.VAPID_SUBJECT)push.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);else push=null;}catch{}
const secure=process.env.COOKIE_SECURE==='true';
if(process.env.NODE_ENV==='production'&&(!secure||!origin.startsWith('https://')||!authReady))throw new Error('Production requires HTTPS, secure cookies and configured email authentication');
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req,max=100000){let n=0,chunks=[];for await(const chunk of req){n+=chunk.length;if(n>max)fail('Слишком большой запрос',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('Некорректный JSON');}}
function rate(key,limit,period){const t=Date.now(),old=db.prepare('SELECT * FROM rate_limits WHERE key=?').get(key);if(old&&old.expires>t&&old.count>=limit)fail('Слишком много запросов. Попробуйте позже.',429);db.prepare('INSERT OR REPLACE INTO rate_limits VALUES (?,?,?)').run(key,old&&old.expires>t?old.count+1:1,old&&old.expires>t?old.expires:t+period);}
function identity(req){const raw=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('challenge_session='))?.slice(18);if(!raw)return null;return db.prepare('SELECT a.* FROM sessions s JOIN accounts a ON a.id=s.user_id WHERE s.hash=? AND s.expires>?').get(hash(raw),Date.now());}
function mustUser(req){const u=identity(req);if(!u)fail('Войдите по электронной почте',401);return u;}
function publicState(u){return store.transaction(()=>{const s=store.load(u.id),before=JSON.stringify(s);ensureDays(s);if(before!==JSON.stringify(s)){s.revision++;store.save(u.id,s);}return s;});}
function cookie(value,age=2592000){return `challenge_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure?'; Secure':''}`;}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  try {
    const url=new URL(req.url,origin),path=url.pathname;
    if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==origin)fail('Запрос с другого сайта отклонён',403);
    if(path==='/api/config')return json(res,200,{authReady,trialReady:trial,pushReady:!!push,vapidPublicKey:push?process.env.VAPID_PUBLIC_KEY:null});
    if(path==='/api/trial'&&req.method==='POST'&&trial){
      if(!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))fail('Пробный режим доступен только на этом компьютере',403);
      const email='local-preview@device.invalid';let u=db.prepare('SELECT * FROM accounts WHERE email=?').get(email);
      if(!u){u={id:crypto.randomUUID(),email,created:Date.now()};db.prepare('INSERT INTO accounts VALUES (?,?,?)').run(u.id,u.email,u.created);}
      const token=randomBytes(32).toString('base64url');db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token),u.id,Date.now()+30*86400000);res.setHeader('Set-Cookie',cookie(token));return json(res,200,{ok:true});
    }
    if(path==='/api/auth/request'&&req.method==='POST'){
      if(!authReady)fail('Отправка кодов ещё не настроена владельцем сервера',503);rate('ip:'+req.socket.remoteAddress,20,3600000);
      const data=await body(req),email=String(data.email??'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)fail('Проверьте email');
      rate('mail:'+hash(email),5,3600000);const old=db.prepare('SELECT sent FROM login_codes WHERE email=?').get(email);if(old&&Date.now()-old.sent<60000)fail('Повторный код можно запросить через минуту',429);
      if(process.env.ALLOWED_EMAILS&&!process.env.ALLOWED_EMAILS.toLowerCase().split(',').map(x=>x.trim()).includes(email))return json(res,200,{ok:true});
      const code=String(randomInt(100000,1000000)),codeHash=createHmac('sha256',process.env.AUTH_SECRET).update(email+':'+code).digest('hex');
      db.prepare('INSERT OR REPLACE INTO login_codes VALUES (?,?,?,?,?)').run(email,codeHash,Date.now()+600000,0,Date.now());
      let sent;try{sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.EMAIL_FROM,to:email,subject:'Код входа · 100 дней',text:`Ваш код входа: ${code}. Действует 10 минут. Если вы не запрашивали код, проигнорируйте письмо.`}),signal:AbortSignal.timeout(15000)});}catch{db.prepare('DELETE FROM login_codes WHERE email=?').run(email);fail('Не удалось отправить письмо. Повторите позже.',502);}
      if(!sent.ok){db.prepare('DELETE FROM login_codes WHERE email=?').run(email);fail('Не удалось отправить письмо. Проверьте настройку почтового сервиса.',502);}return json(res,200,{ok:true});
    }
    if(path==='/api/auth/verify'&&req.method==='POST'){
      if(!authReady)fail('Вход ещё не настроен',503);rate('verify:'+req.socket.remoteAddress,40,3600000);const data=await body(req),email=String(data.email??'').trim().toLowerCase(),entry=db.prepare('SELECT * FROM login_codes WHERE email=?').get(email);
      if(!entry||entry.expires<Date.now()||entry.attempts>=5)fail('Код недействителен. Запросите новый.',401);
      db.prepare('UPDATE login_codes SET attempts=attempts+1 WHERE email=?').run(email);const candidate=createHmac('sha256',process.env.AUTH_SECRET).update(email+':'+String(data.code??'')).digest();if(!timingSafeEqual(candidate,Buffer.from(entry.hash,'hex')))fail('Неверный код',401);
      let u;store.transaction(()=>{db.prepare('DELETE FROM login_codes WHERE email=?').run(email);u=db.prepare('SELECT * FROM accounts WHERE email=?').get(email);if(!u){u={id:crypto.randomUUID(),email,created:Date.now()};db.prepare('INSERT INTO accounts VALUES (?,?,?)').run(u.id,u.email,u.created);}});
      const token=randomBytes(32).toString('base64url');db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token),u.id,Date.now()+30*86400000);res.setHeader('Set-Cookie',cookie(token));return json(res,200,{ok:true});
    }
    if(path==='/api/me'){const u=mustUser(req);return json(res,200,{email:u.email,id:u.id,state:publicState(u)});}
    if(path==='/api/calculate'&&req.method==='POST'){mustUser(req);return json(res,200,calculate((await body(req)).profile));}
    if(path==='/api/sync'&&req.method==='POST'){
      const u=mustUser(req),op=await body(req);if(typeof op.id!=='string'||op.id.length>100)fail('Нет идентификатора операции');
      const result=store.transaction(()=>{const s=store.load(u.id);if(db.prepare('SELECT 1 FROM sync_operations WHERE user_id=? AND id=?').get(u.id,op.id))return s;
        if(op.baseRevision!==s.revision)fail('История изменилась на другом устройстве. Сравните изменения перед сохранением.',409);
        apply(s,op.action);s.revision++;store.save(u.id,s);db.prepare('INSERT INTO sync_operations VALUES (?,?,?)').run(u.id,op.id,Date.now());return s;});return json(res,200,{state:result});
    }
    if(path==='/api/logout'&&req.method==='POST'){const token=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('challenge_session='))?.slice(18);if(token)db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(token));res.setHeader('Set-Cookie',cookie('',0));return json(res,200,{ok:true});}
    if(path==='/api/push'&&req.method==='POST'){const u=mustUser(req);if(!push)fail('Серверные push-уведомления ещё не настроены',503);const sub=await body(req);const endpoint=new URL(sub.endpoint);if(endpoint.protocol!=='https:'||!(/(^|\.)fcm\.googleapis\.com$|(^|\.)push\.services\.mozilla\.com$|(^|\.)notify\.windows\.com$|(^|\.)push\.apple\.com$/.test(endpoint.hostname)))fail('Неподдерживаемый push-сервис');if(!sub.keys?.p256dh||!sub.keys?.auth)fail('Недействительная подписка');const s=store.load(u.id);const id=hash(sub.endpoint);s.subscriptions=s.subscriptions.filter(x=>x.id!==id);s.subscriptions.push({id,...sub});s.revision++;store.transaction(()=>store.save(u.id,s));return json(res,200,{ok:true,state:s});}
    if(path==='/api/photos'&&req.method==='POST'){
      const u=mustUser(req),data=await body(req,8e6);if(!/^\d{4}-\d{2}-\d{2}$/.test(data.date)||!['image/jpeg','image/png','image/webp'].includes(data.mime))fail('Проверьте фото и дату');const bytes=Buffer.from(data.base64??'','base64');if(bytes.length>5e6||bytes.length<12)fail('Фото должно быть до 5 МБ');
      const valid=data.mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:data.mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';if(!valid)fail('Формат фото не совпадает с файлом');
      const id=crypto.randomUUID();await writeFile(join(photosDir,id),bytes,{mode:0o600});try{const s=store.load(u.id);s.photos.push({id,date:data.date,mime:data.mime,created:Date.now()});s.revision++;store.transaction(()=>store.save(u.id,s));return json(res,200,{state:s});}catch(e){await unlink(join(photosDir,id)).catch(()=>{});throw e;}
    }
    if(path.startsWith('/api/photos/')&&req.method==='GET'){const u=mustUser(req),id=path.split('/').at(-1),photo=store.load(u.id).photos.find(x=>x.id===id);if(!photo)fail('Фото не найдено',404);res.writeHead(200,{'Content-Type':photo.mime,'Cache-Control':'no-store','Content-Disposition':'inline'});return res.end(await readFile(join(photosDir,photo.id)));}
    if(path==='/api/export'&&req.method==='GET'){
      const u=mustUser(req),s=publicState(u),format=url.searchParams.get('format');res.setHeader('Cache-Control','no-store');
      if(format==='csv'){const rows=[['type','date','timezone','stage','calories','protein','fat','carbs','sugar','water','steps','calorie_goal','protein_goal','water_goal','steps_goal','workout','percent','credited','weight','waist','hips','chest','abdomen','leg','note']];for(const d of s.days)rows.push(['day',d.date,d.timezone,d.stage,...['calories','protein','fat','carbs','sugar','water','steps'].map(k=>d.values[k]??''),d.goal.calories??'',d.goal.protein??'',d.water,d.steps,d.workout?d.workoutResult??'missing':'rest',evaluation(d).percent,d.credited,'','','','','','',d.note]);for(const b of s.body)rows.push(['body',b.date,...Array(16).fill(''),b.weight??'',...['waist','hips','chest','abdomen','leg'].map(k=>b.measurements[k]??''),'']);const esc=v=>'"'+String(v).replace(/^[=+\-@\t\r]/,"'"+'$&').replaceAll('"','""')+'"';res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="challenge.csv"'});return res.end('\ufeff'+rows.map(r=>r.map(esc).join(',')).join('\r\n'));}
      if(format==='photos'){// Uncompressed TAR, no dependency or public storage URLs.
        res.writeHead(200,{'Content-Type':'application/x-tar','Content-Disposition':'attachment; filename="progress-photos.tar"'});for(const p of s.photos){const b=await readFile(join(photosDir,p.id)),h=Buffer.alloc(512),name=`${p.date}-${p.id}.${p.mime.split('/')[1]}`;h.write(name,0,100);h.write('0000600\0',100,8);h.write('0000000\0',108,8);h.write('0000000\0',116,8);h.write(b.length.toString(8).padStart(11,'0')+'\0',124,12);h.write(Math.floor(p.created/1000).toString(8).padStart(11,'0')+'\0',136,12);h.fill(32,148,156);h[156]=48;h.write('ustar\0',257,6);h.write('00',263,2);const sum=h.reduce((a,x)=>a+x,0);h.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8);res.write(h);res.write(b);res.write(Buffer.alloc((512-b.length%512)%512));}res.end(Buffer.alloc(1024));return;}
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="challenge-history.json"'});const exported={...s};delete exported.subscriptions;return res.end(JSON.stringify({version:1,exportedAt:new Date().toISOString(),email:u.email,...exported},null,2));
    }
    if(path==='/api/account'&&req.method==='DELETE'){const u=mustUser(req),data=await body(req);if(data.confirm!==u.email)fail('Введите email для подтверждения удаления');const s=store.load(u.id);for(const p of s.photos)await unlink(join(photosDir,p.id)).catch(e=>{if(e.code!=='ENOENT')throw e;});store.transaction(()=>db.prepare('DELETE FROM accounts WHERE id=?').run(u.id));db.prepare('DELETE FROM login_codes WHERE email=?').run(u.email);res.setHeader('Set-Cookie',cookie('',0));return json(res,200,{ok:true});}
    if(path.startsWith('/api/'))fail('Маршрут не найден',404);
    if(!['GET','HEAD'].includes(req.method))fail('Метод недоступен',405);
    const names={'/':'index.html','/index.html':'index.html','/app.mjs':'app.mjs','/styles.css':'styles.css','/sw.js':'sw.js','/manifest.webmanifest':'manifest.webmanifest','/icon.svg':'icon.svg','/icon-192.png':'icon-192.png','/icon-512.png':'icon-512.png','/domain.mjs':'../src/domain.mjs','/weight-model.mjs':'../src/weight-model.mjs'};if(!names[path])fail('Страница не найдена',404);
    const file=resolve(pub,names[path]),ext=file.split('.').at(-1),types={html:'text/html',mjs:'text/javascript',js:'text/javascript',css:'text/css',webmanifest:'application/manifest+json',svg:'image/svg+xml',png:'image/png'};res.writeHead(200,{'Content-Type':(types[ext]??'application/octet-stream')+'; charset=utf-8','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:await readFile(file));
  }catch(e){if(!res.headersSent)json(res,e.status??500,{error:e.status?e.message:'Не удалось сохранить. Повторите позже.'});else res.end();/* Deliberately do not log request bodies, identity, health values or authentication errors. */}
});
let ticking=false;async function tick(){if(ticking)return;ticking=true;try{const now=Date.now();db.prepare('DELETE FROM sessions WHERE expires<?').run(now);db.prepare('DELETE FROM login_codes WHERE expires<?').run(now);db.prepare('DELETE FROM rate_limits WHERE expires<?').run(now);
  for(const u of db.prepare('SELECT id,email FROM accounts').all()){
    const s=publicState(u),c=current(s);if(!push||!c)continue;const date=dateAt(now,s.settings.timezone),d=s.days.find(x=>x.challengeId===c.id&&x.date===date);if(!d||d.paused||d.closed)continue;
    const hm=new Intl.DateTimeFormat('en-GB',{timeZone:s.settings.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
    for(const kind of ['morning','evening']){if(!s.settings[kind+'Enabled']||hm<s.settings[kind])continue;const scheduled=s.settings[kind],mins=t=>+t.slice(0,2)*60+(+t.slice(3)),late=mins(hm)-mins(scheduled);if(late>15)continue;if(kind==='evening'&&!evaluation(d).tasks.some(x=>x.value===null))continue;
      const event=date+':'+kind;if(db.prepare('SELECT 1 FROM notifications WHERE user_id=? AND event=?').get(u.id,event))continue;db.prepare('INSERT INTO notifications VALUES (?,?,?)').run(u.id,event,now);
      const text=kind==='morning'?`Этап ${d.stage}. Ваш план на сегодня уже в дневнике.`:'Остались незаполненные задачи. Можно сохранить и часть дня.';
      for(const sub of s.subscriptions)try{await push.sendNotification(sub,JSON.stringify({title:'100 дней · ваш ритм',body:text,tag:event}),{TTL:900,timeout:10000});}catch(e){if([404,410].includes(e.statusCode)){const latest=store.load(u.id);latest.subscriptions=latest.subscriptions.filter(x=>x.id!==sub.id);latest.revision++;store.transaction(()=>store.save(u.id,latest));}}
    }
  }
}catch{/* No health data in logs. */}finally{ticking=false;}}
const timer=setInterval(tick,30000);timer.unref();server.listen(port,host,()=>console.log(`100 days server: ${origin}; email ${authReady?'configured':'not configured'}; push ${push?'configured':'not configured'}`));
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{clearInterval(timer);server.close(()=>{store.close();process.exit(0);});});
