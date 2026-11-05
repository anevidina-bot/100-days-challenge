import {compareScenarios,prepareModel,projectWeight,MODEL_VERSION} from './weight-model.mjs';
export const RULES_VERSION = '0.4-adjustable-deficit-2026-11-05';
export const STAGES = [
  ['Ритм питания','Соблюдать целевую калорийность','Начните с наблюдения за своим обычным днём.'],
  ['Белок в фокусе','Добавить норму белка','Добавляйте источник белка к привычным приёмам пищи.'],
  ['Осознанный выбор','Продукты с добавленным сахаром — до 20%','Считайте калорийность всей съеденной порции.'],
  ['Глоток за глотком','Добавить чистую воду','Поставьте воду там, где часто бываете.'],
  ['Больше движения','Добавить 6000 шагов','Короткие прогулки тоже складываются в день.'],
  ['Время для себя','Три тренировки в неделю','Выберите удобные дни заранее.'],
  ['Шаг за шагом','Повысить цель до 8000 шагов','Новая цель заменяет предыдущую.'],
  ['Находим баланс','Добавить баланс БЖУ','Смотрите на все три показателя вместе.'],
  ['Движение в привычке','Повысить цель до 10 000 шагов','Подберите удобный для себя объём движения.'],
  ['Ваш личный ритм','Закрепить привычки','Что вы хотите сохранить после челленджа? Рефлексия необязательна.']
];
export function fail(message, status=400) { throw Object.assign(new Error(message),{status}); }
export function dateAt(ms, timezone) { return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms)); }
export function addDays(date, n) { return new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10); }
export function validDate(s) { return typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s; }
export function validateZone(z) { try { dateAt(Date.now(),z); } catch { fail('Неизвестный часовой пояс'); } return z; }
export function weekday(d) { return (new Date(d+'T12:00Z').getUTCDay()+6)%7; }
export function weekStart(d) { return addDays(d,-weekday(d)); }
export function midnight(date, zone) {
  const target=Date.parse(date+'T00:00:00Z'); let ms=target;
  for(let i=0;i<5;i++) {
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).map(x=>[x.type,x.value]));
    const shown=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second); const diff=target-shown; ms+=diff; if(!diff) break;
  } return ms;
}
export function finite(x, name, min=0, max=1e6) { if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max) fail('Проверьте поле «'+name+'»'); return x; }
export function calculate(p) {
  finite(p.age,'Возраст',18,120); finite(p.height,'Рост',100,250); finite(p.weight,'Вес',25,400); finite(p.desiredWeight,'Желаемый вес',25,400);
  if(!['female','male'].includes(p.sex)) fail('Выберите пол расчётной формулы');
  if(![1.4,1.6,1.8,2.2].includes(p.pal)) fail('Выберите активность');
  const ree=10*p.weight+6.25*p.height-5*p.age+(p.sex==='male'?5:-161), maintenance=ree*p.pal;
  const bmi=p.weight/(p.height/100)**2, desiredBmi=p.desiredWeight/(p.height/100)**2;
  const reasons=[];
  if(p.age<19||p.age>78) reasons.push('Возраст вне области автоматического расчёта 19–78 лет.');
  if(bmi<18.5) reasons.push('При ИМТ ниже 18,5 автоматический дефицит недоступен: нужен индивидуальный подбор питания.');
  if(desiredBmi<18.5) reasons.push('Желаемый вес ниже установленной границы ИМТ 18,5.');
  if(p.pregnant||p.breastfeeding||p.individualDiet) reasons.push('Нужен индивидуальный подбор питания.');
  const floor=p.sex==='male'?1500:1200, maxDeficit=Math.max(0,Math.min(750,maintenance*.25,maintenance-floor));
  if(!maxDeficit) reasons.push('Нет доступного автоматического дефицита.');
  const requestedDeficitPercent=finite(p.deficitPercent??15,'Процент дефицита',0,25);
  const calories=Math.min(Math.floor(maintenance),Math.ceil(maintenance-Math.min(maintenance*requestedDeficitPercent/100,maxDeficit)));
  const base={ree:Math.round(ree),maintenance:Math.round(maintenance),maintenanceExact:maintenance,floor,maxDeficit,reasons,eligible:!reasons.length,calories,requestedDeficitPercent,rulesVersion:RULES_VERSION};
  const scenarios=compareScenarios(p,base,p.horizonDays??100);
  return {...base,scenarios,forecast:scenarios.moderate?.predictedWeight??null,forecastReason:'Динамический модельный сценарий Hall/NIDDK. Предполагаются постоянный рацион и прежняя активность; результат не гарантирован.'};
}
export function macros(calories, weight) {
  const ranges={protein:[Math.ceil(Math.max(.8*weight,.10*calories/4)),Math.floor(.35*calories/4)],fat:[Math.ceil(.20*calories/9),Math.floor(.35*calories/9)],carbs:[Math.ceil(Math.max(130,.45*calories/4)),Math.floor(.65*calories/4)]};
  const lo=4*ranges.protein[0]+9*ranges.fat[0]+4*ranges.carbs[0], hi=4*ranges.protein[1]+9*ranges.fat[1]+4*ranges.carbs[1];
  if(Object.values(ranges).some(([a,b])=>a>b)||lo>calories||hi<calories) fail('Нормы БЖУ несовместимы. Нужен индивидуальный подбор.');
  return ranges;
}
export function makeGoal(p, requested, planning={}) {
  const days=planning.days??p.horizonDays??100;finite(days,'Срок',1,730);if(!Number.isInteger(days))fail('Срок должен быть целым числом дней');
  const c=calculate({...p,deficitPercent:planning.deficitPercent??p.deficitPercent??15,horizonDays:days}); if(!c.eligible) return {calories:null,ranges:null,protein:null,calculation:c,weight:p.weight,deficitPercent:c.requestedDeficitPercent,rulesVersion:RULES_VERSION};
  const scenario=requested!==undefined?'custom':planning.scenario??'moderate';if(!['custom','moderate','deadline'].includes(scenario))fail('Выберите вариант калорийности');
  if(scenario!=='custom'&&!c.scenarios[scenario]?.allowed)fail(c.scenarios[scenario]?.reason??'Сценарий недоступен');
  const calories=requested??c.scenarios[scenario].calories; finite(calories,'Калории',c.floor,c.maintenanceExact);
  if(c.maintenanceExact-calories>c.maxDeficit+1e-8) fail('Калорийность превышает допустимый дефицит');
  const predictedWeight=scenario==='custom'?projectWeight(prepareModel(p,c.maintenanceExact/p.pal),calories,days).weight:c.scenarios[scenario].predictedWeight;
  if(predictedWeight/(p.height/100)**2<18.5)fail('Модельный вес к дате ниже границы ИМТ 18,5');
  const ranges=macros(calories,p.weight); return {calories,ranges,protein:ranges.protein[0],calculation:c,weight:p.weight,deficitPercent:c.requestedDeficitPercent,rulesVersion:RULES_VERSION,scenario,targetDate:planning.targetDate??null,calculationStart:planning.start??null,horizonDays:days,forecast:{modelVersion:MODEL_VERSION,weight:predictedWeight,days,calories}};
}
export function planningDates(start,targetDate){
  const target=targetDate??addDays(start,100);if(!validDate(start)||!validDate(target))fail('Проверьте дату цели');
  const days=(Date.parse(target)-Date.parse(start))/86400000;if(!Number.isInteger(days)||days<1||days>730)fail('Дата цели должна быть через 1–730 дней от начала расчёта');return {start,targetDate:target,days};
}
export function stageTargets(s, stage) {
  const stepStage=stage>=9?9:stage>=7?7:5;
  return {water:s.settings.stageWater?.[4]??s.settings.water??1500,steps:s.settings.stageSteps?.[stepStage]??(stepStage===9?10000:stepStage===7?8000:6000)};
}
export function tasks(day) {
  if(day.paused||day.beforeStart) return [];
  const g=day.goal, v=day.values, out=[];
  const put=(id,title,unit,target,ok)=>out.push({id,title,unit,target,value:v[id]??null,done:v[id]!==null&&v[id]!==undefined&&ok(v[id])});
  if(g.calories!==null) put('calories','Калорийность','ккал',`${g.calories-100}–${g.calories+100}`,x=>x>=g.calories-100&&x<=g.calories+100);
  if(day.stage>=2&&g.protein!==null) put('protein','Белок','г','≥ '+g.protein,x=>x>=g.protein);
  if(day.stage>=3&&g.calories!==null) put('sugar','Продукты с добавленным сахаром','ккал','≤ '+g.calories*.2,x=>x<=g.calories*.2);
  if(day.stage>=4) put('water','Чистая вода','мл','≥ '+day.water,x=>x>=day.water);
  if(day.stage>=5) put('steps','Шаги','шагов','≥ '+day.steps,x=>x>=day.steps);
  if(day.stage>=6&&day.workout) { const value=day.workoutResult??null; out.push({id:'workout',title:'Тренировка',unit:'',target:'Выполнить',value,done:value==='done'}); }
  if(day.stage>=8&&g.ranges) {
    const done=['protein','fat','carbs'].every(k=>v[k]!=null&&v[k]>=g.ranges[k][0]&&v[k]<=g.ranges[k][1]);
    out.push({id:'balance',title:'Баланс БЖУ',unit:'г',target:Object.entries(g.ranges).map(([k,r])=>({protein:'Б',fat:'Ж',carbs:'У'}[k])+': '+r.join('–')).join(' · '),value:['protein','fat','carbs'].every(k=>v[k]!=null)?'Введено':null,done});
  } return out;
}
export function evaluation(d) { const t=tasks(d),done=t.filter(x=>x.done).length; return {tasks:t,done,total:t.length,percent:t.length?Math.round(done/t.length*100):0,success:t.length>0&&done===t.length&&!d.diaryOnly}; }
export function newState() {return {profile:null,settings:{timezone:'Europe/Moscow',water:1500,stageSteps:{},stageWater:{},workoutDays:[0,2,4],morning:'07:00',evening:'21:00',morningEnabled:true,eveningEnabled:true},challenges:[],goals:[],days:[],body:[],awards:[],audit:[],photos:[],subscriptions:[],revision:0};}
export function current(s) { return s.challenges.find(x=>x.status==='active')??null; }
export function goalOn(s,c,date) { return s.goals.filter(x=>x.challengeId===c.id&&x.effective<=date).sort((a,b)=>b.effective.localeCompare(a.effective)||b.created-a.created)[0]; }
export function workoutDaysOn(s,c,date) { return (c.scheduleVersions??[]).filter(x=>x.effective<=date).at(-1)?.days??s.settings.workoutDays; }
export function ensureDays(s, now=Date.now()) {
  const c=current(s); if(!c) return;
  const today=dateAt(now,s.settings.timezone); if(c.start>today) return;
  let last=s.days.filter(x=>x.challengeId===c.id).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
  // Close using the original timezone's end instant, never a newly selected timezone.
  function close(d) { if(d.closed||now<d.endAt) return; d.closed=true; if(d.workout&&!d.workoutResult)d.workoutResult='missed'; const e=evaluation(d); d.credited=e.success; if(d.credited){c.successes++; const completedStage=Math.floor(c.successes/10); if(c.successes%10===0){s.awards.push({id:crypto.randomUUID(),challengeId:c.id,stage:completedStage,date:d.date});c.stage=Math.min(10,completedStage+1);} if(c.successes>=100){c.status='complete';c.finished=d.date;} } }
  if(last) close(last);
  let next=last?addDays(last.date,1):c.start;
  // Bound work from malformed or very old dates. UI restricts start to 1 year back.
  for(let guard=0;guard<4000&&next<=today&&c.status==='active';guard++,next=addDays(next,1)) {
    if(last&&!last.closed) break;
    const goal=goalOn(s,c,next); if(!goal) fail('Отсутствует версия норм',500);
    const targets=stageTargets(s,c.stage); const paused=c.pauses.some(x=>next>=x.from&&(!x.to||next<x.to));
    const movedFrom=(c.moves??[]).some(x=>x.from===next),movedTo=(c.moves??[]).some(x=>x.to===next);
    const day={id:c.id+':'+next,challengeId:c.id,date:next,timezone:s.settings.timezone,endAt:midnight(addDays(next,1),s.settings.timezone),stage:c.stage,goal:structuredClone(goal),...targets,values:{},note:'',paused,diaryOnly:goal.calories===null,workout:!paused&&c.stage>=6&&(movedTo||(!movedFrom&&workoutDaysOn(s,c,next).includes(weekday(next)))),workoutResult:null,closed:false,credited:false};
    s.days.push(day); last=day; close(day);
  }
}
export function apply(s, action, now=Date.now()) {
  ensureDays(s,now); const {type,data={}}=action; const today=dateAt(now,s.settings.timezone), c=current(s);
  if(data.challengeId!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.challengeId))fail('Некорректный идентификатор челленджа');
  if(type==='onboard') {
    if(s.profile) fail('Профиль уже создан');
    const p=data.profile; if(!p?.adult||p.age<18) fail('Приложение только для совершеннолетних');
    validateZone(p.timezone); s.settings.timezone=p.timezone; const localToday=dateAt(now,p.timezone);
    if(!validDate(data.start)||data.start<addDays(localToday,-365)||data.start>addDays(localToday,365)) fail('Выберите дату в пределах года от сегодня');
    const planning={...planningDates(data.start,data.targetDate),scenario:data.scenario??'moderate'},goal=makeGoal(p,data.calories,planning); s.profile={...p,initialWeight:p.weight,targetDate:planning.targetDate,initialComment:String(p.initialComment??'').slice(0,2000)};
    const original=calculate({...p,horizonDays:100});
    const challenge={id:data.challengeId??crypto.randomUUID(),start:data.start,stage:1,successes:0,status:'active',pauses:[],scheduleVersions:[{effective:data.start,days:[0,2,4]}],originalForecast:{date:addDays(data.start,100),model:MODEL_VERSION,scenarios:original.scenarios,reason:goal.calculation.forecastReason},created:now};
    s.challenges.push(challenge);s.goals.push({...goal,id:crypto.randomUUID(),challengeId:challenge.id,effective:data.start,created:now});s.body.push({id:crypto.randomUUID(),date:localToday,weight:p.weight,measurements:{},created:now});
  } else if(type==='day') {
    const d=s.days.find(x=>x.id===data.id); if(!d)fail('День не найден',404);
    if(d.paused) fail('В день паузы задач нет');
    if(!d.closed&&[4,5,6,7,9].includes(d.stage)&&!s.challenges.find(x=>x.id===d.challengeId).stageSetups?.[d.stage])fail('Сначала подтвердите настройки нового этапа');
    if(d.closed&&!data.acknowledgeHistory) fail('Исправление истории не меняет начисленный прогресс. Подтвердите это ограничение.');
    const patch={}; for(const [k,v] of Object.entries(data.values??{})){ if(!['calories','protein','sugar','water','steps','fat','carbs'].includes(k))fail('Неизвестный показатель');if(v!==null)finite(v,k,0,k==='steps'?200000:50000);patch[k]=v; }
    if(data.workoutResult!==undefined) { if(d.closed)fail('Прошлую тренировку изменить нельзя');if(!d.workout||!['done','missed',null].includes(data.workoutResult))fail('Проверьте тренировку');d.workoutResult=data.workoutResult; }
    s.audit.push({id:crypto.randomUUID(),dayId:d.id,at:now,before:{values:structuredClone(d.values),note:d.note},after:{values:{...d.values,...patch},note:data.note??d.note}});
    Object.assign(d.values,patch);if(data.note!==undefined)d.note=String(data.note).slice(0,3000);
  } else if(type==='moveWorkout') {
    const d=s.days.find(x=>x.id===data.id); if(!d||d.closed||!d.workout||d.workoutResult==='done')fail('Перенос недоступен');
    const target=data.date;if(!validDate(target)||target<=d.date||weekStart(target)!==weekStart(d.date))fail('Выберите более позднюю дату той же недели');
    const challenge=s.challenges.find(x=>x.id===d.challengeId); const other=s.days.find(x=>x.challengeId===d.challengeId&&x.date===target);
    if(other?.workout||workoutDaysOn(s,challenge,target).includes(weekday(target))||(challenge.moves??[]).some(x=>x.to===target)) fail('На эту дату уже назначена тренировка');
    if(challenge.pauses.some(x=>target>=x.from&&(!x.to||target<x.to)))fail('На эту дату назначена пауза');
    d.workout=false;d.workoutResult=null; (challenge.moves??=[]).push({id:crypto.randomUUID(),from:d.date,to:target,at:now}); if(other)other.workout=true;
  } else if(type==='stageSetup') {
    if(!c||![4,5,6,7,9].includes(c.stage))fail('Настройка этапа недоступна');
    const d=s.days.find(x=>x.challengeId===c.id&&x.date===today&&!x.closed);if(!d||d.paused)fail('Нет открытого дня этапа');
    if(c.stageSetups?.[c.stage])fail('Настройки этапа уже приняты');
    if(c.stage===4){const water=finite(data.water,'Вода',0,10000);s.settings.stageWater[4]=water;d.water=water;}
    if([5,7,9].includes(c.stage)){const steps=finite(data.steps,'Шаги',0,100000);s.settings.stageSteps[c.stage]=steps;d.steps=steps;}
    if(c.stage===6){const days=data.workoutDays;if(!Array.isArray(days)||days.length!==3||new Set(days).size!==3||days.some(x=>!Number.isInteger(x)||x<0||x>6))fail('Выберите три дня недели');s.settings.workoutDays=days;c.scheduleVersions.push({effective:today,days});d.workout=days.includes(weekday(today));}
    (c.stageSetups??={})[c.stage]=true;
  } else if(type==='body') {
    if(!s.profile)fail('Сначала заполните профиль');if(!validDate(data.date)||data.date>today)fail('Проверьте дату');
    const measurements={}; for(const [k,v] of Object.entries(data.measurements??{})){if(!['waist','hips','chest','abdomen','leg'].includes(k))fail('Неизвестный замер');if(v!==null)measurements[k]=finite(v,k,1,400);}
    const weight=data.weight==null?null:finite(data.weight,'Вес',25,400);s.body.push({id:crypto.randomUUID(),date:data.date,weight,measurements,created:now});
  } else if(type==='goal') {
    if(!c)fail('Нет активного челленджа');const latest=s.body.filter(x=>x.weight!==null).sort((a,b)=>a.date.localeCompare(b.date)||a.created-b.created).at(-1);
    const effective=addDays(today,1),start=c.start>effective?c.start:effective,priorTarget=s.profile.targetDate??c.originalForecast.date,planning={...planningDates(start,data.targetDate??(priorTarget>start?priorTarget:addDays(start,100))),scenario:data.scenario??'moderate'};
    const p={...s.profile,weight:latest?.weight??s.profile.weight,desiredWeight:data.desiredWeight??s.profile.desiredWeight,deficitPercent:data.deficitPercent??s.profile.deficitPercent??15};const goal=makeGoal(p,data.calories,planning);if(!goal.calculation.eligible&&data.calories!=null)fail('Автоматическая цель недоступна');
    s.profile.desiredWeight=p.desiredWeight;s.profile.deficitPercent=p.deficitPercent;s.profile.targetDate=planning.targetDate;s.goals.push({...goal,id:crypto.randomUUID(),challengeId:c.id,effective,created:now,forecastUpdated:today});
  } else if(type==='settings') {
    if(data.timezone) {validateZone(data.timezone);s.settings.timezone=data.timezone;}
    for(const k of ['morning','evening'])if(data[k]!==undefined){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(data[k]))fail('Проверьте время');s.settings[k]=data[k];}
    for(const k of ['morningEnabled','eveningEnabled'])if(data[k]!==undefined)s.settings[k]=!!data[k];
    if(data.stage!==undefined){finite(data.stage,'Этап',1,10);if(!Number.isInteger(data.stage))fail('Проверьте этап'); if(data.water!==undefined)s.settings.stageWater[data.stage]=finite(data.water,'Вода',0,10000);if(data.steps!==undefined)s.settings.stageSteps[data.stage]=finite(data.steps,'Шаги',0,100000);}
    if(data.workoutDays){if(data.workoutDays.length!==3||new Set(data.workoutDays).size!==3||data.workoutDays.some(x=>!Number.isInteger(x)||x<0||x>6))fail('Выберите три разных дня');s.settings.workoutDays=data.workoutDays;if(c)c.scheduleVersions.push({effective:addDays(weekStart(today),7),days:data.workoutDays});}
  } else if(type==='pause') {
    if(!c)fail('Нет активного челленджа');const open=c.pauses.find(x=>!x.to);if(data.resume){if(!open)fail('Челлендж не на паузе');if(open.from>today)c.pauses=c.pauses.filter(x=>x!==open);else open.to=addDays(today,1);}else{if(open)fail('Пауза уже запланирована');c.pauses.push({from:addDays(today,1),to:null});}
  } else if(type==='startDate') {
    if(!c||c.start<=today)fail('Дата старта уже наступила');if(!validDate(data.date)||data.date<today||data.date>addDays(today,365))fail('Проверьте дату старта');const old=c.start,priorTarget=s.profile.targetDate??addDays(old,100),target=priorTarget===addDays(old,100)?addDays(data.date,100):priorTarget,planning=planningDates(data.date,target);c.start=data.date;c.originalForecast.date=addDays(data.date,100);for(const g of s.goals.filter(x=>x.challengeId===c.id&&x.effective===old)){const updated=makeGoal({...s.profile,weight:g.weight},g.scenario==='custom'?g.calories:undefined,{...planning,scenario:g.scenario??'moderate'});Object.assign(g,updated,{effective:data.date});}s.profile.targetDate=target;c.scheduleVersions[0].effective=data.date;
  } else if(type==='restart') {
    if(!s.profile)fail('Нет профиля');if(!data.confirm)fail('Подтвердите завершение текущего челленджа'); if(c){c.status='archived';c.finished=today;for(const d of s.days.filter(x=>x.challengeId===c.id&&!x.closed)){d.closed=true;if(d.workout&&!d.workoutResult)d.workoutResult='missed';}}
    const start=addDays(today,1),id=data.challengeId??crypto.randomUUID(),latest=s.body.filter(x=>x.weight!==null).sort((a,b)=>a.date.localeCompare(b.date)||a.created-b.created).at(-1),p={...s.profile,weight:latest?.weight??s.profile.weight},planning=planningDates(start),goal=makeGoal(p,undefined,planning);
    s.profile.targetDate=planning.targetDate;
    s.challenges.push({id,start,stage:1,successes:0,status:'active',pauses:[],scheduleVersions:[{effective:start,days:s.settings.workoutDays}],originalForecast:{date:planning.targetDate,model:MODEL_VERSION,scenarios:goal.calculation.scenarios,reason:goal.calculation.forecastReason},created:now});
    s.goals.push({...goal,id:crypto.randomUUID(),challengeId:id,effective:start,created:now});
  } else fail('Неизвестное действие');
  ensureDays(s,now); for(const challenge of s.challenges)for(const move of challenge.moves??[]){const from=s.days.find(x=>x.challengeId===challenge.id&&x.date===move.from),to=s.days.find(x=>x.challengeId===challenge.id&&x.date===move.to);if(from)from.workout=false;if(to)to.workout=true;}
  return s;
}
