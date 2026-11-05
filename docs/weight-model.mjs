// Hall et al. (2011), calibrated against the NIDDK Body Weight Planner services.
// Equations and provenance: MODEL_VALIDATION.md. Original implementation, no runtime network access.
export const MODEL_VERSION='hall-2011-niddk-kcal-rk4-v1';
export const ASSUMPTIONS={carbohydratePercent:50,baselineSodiumMg:4000,sodium:'proportional-to-energy',activity:'unchanged',initialBalance:'maintenance',stepDays:0.25};
export function prepareModel(profile, rmr) {
  const {weight,height,age,sex,pal}=profile;
  if(![weight,height,age,pal,rmr].every(Number.isFinite)||weight<=0||height<=0||rmr<=0)throw new Error('Некорректные исходные данные модели');
  const bmi=weight/(height/100)**2;
  const fatPercent=Math.max(0,Math.min(60,.14*age+(sex==='male'?37.31:39.96)*Math.log(bmi)-(sex==='male'?103.94:102.01)));
  const fat=weight*fatPercent/100,lean=weight-fat,maintenance=rmr*pal,activity=(.9*maintenance-rmr)/weight;
  if(fat<=0||lean<=0||activity<0)throw new Error('Исходные данные вне области модели');
  const constant=.76*maintenance-22*lean-3.2*fat-activity*weight;
  return {weight,maintenance,activity,constant,initial:[fat,lean,.5,0,.14*maintenance],initialCarbohydrate:maintenance*.5};
}
function bodyWeight(b,y){return y[0]+y[1]+3.7*(y[2]-.5)+y[3];}
function derivative(b,y,intake){
  const [fat,lean,glycogen,water,therm]=y;
  const partition=1.990762711864407/(1.990762711864407+fat);
  const glycogenFlux=.5*intake-b.initialCarbohydrate*(glycogen/.5)**2;
  const synthesis=(1-partition)*180/9440+partition*230/1807;
  const expenditure=(b.constant+22*lean+3.2*fat+b.activity*bodyWeight(b,y)+therm+.1*intake+(intake-glycogenFlux)*synthesis)/(1+synthesis);
  const tissueBalance=intake-expenditure-glycogenFlux;
  const sodium=ASSUMPTIONS.baselineSodiumMg*intake/b.maintenance;
  return [(1-partition)*tissueBalance/9440,partition*tissueBalance/1807,glycogenFlux/4180,(sodium-ASSUMPTIONS.baselineSodiumMg-3000*water-4000*(1-intake/b.maintenance))/3220,(.14*intake-therm)/14];
}
function plus(y,k,h){return y.map((v,i)=>v+h*k[i]);}
export function projectWeight(b,intake,days,{step=ASSUMPTIONS.stepDays}={}){
  if(!Number.isFinite(intake)||intake<0||!Number.isInteger(days)||days<0||days>730||!Number.isFinite(step)||step<=0||step>1)throw new Error('Проверьте калорийность и срок (до 730 дней)');
  let y=b.initial.slice();
  for(let elapsed=0;elapsed<days;){
    const h=Math.min(step,days-elapsed),k1=derivative(b,y,intake),k2=derivative(b,plus(y,k1,h/2),intake),k3=derivative(b,plus(y,k2,h/2),intake),k4=derivative(b,plus(y,k3,h),intake);
    y=y.map((v,i)=>v+h*(k1[i]+2*k2[i]+2*k3[i]+k4[i])/6);elapsed+=h;
    if(y.some(x=>!Number.isFinite(x))||y[0]<=0||y[1]<=0||y[2]<0)throw new Error('Сценарий выходит за область численной модели');
  }
  const weight=bodyWeight(b,y);if(!Number.isFinite(weight)||weight<=0)throw new Error('Недопустимый результат модели');
  return {weight,days,intake,modelVersion:MODEL_VERSION};
}
export function compareScenarios(profile,base,days=100){
  const common={days,modelVersion:MODEL_VERSION,assumptions:ASSUMPTIONS};
  if(!Number.isInteger(days)||days<1||days>730)return {...common,moderate:null,deadline:{calories:null,allowed:false,reason:'Выберите срок от 1 до 730 календарных дней.'}};
  if(!base.eligible)return {...common,moderate:null,deadline:{calories:null,allowed:false,reason:base.reasons.join(' ')}};
  try{
    const b=prepareModel(profile,base.maintenanceExact/profile.pal);
    let moderateWeight=null,moderateError='';try{moderateWeight=projectWeight(b,base.calories,days).weight;}catch(e){moderateError=e.message;}
    const moderateAllowed=moderateWeight!==null&&moderateWeight/(profile.height/100)**2>=18.5,moderate={calories:base.calories,deficit:base.maintenanceExact-base.calories,percent:100*(base.maintenanceExact-base.calories)/base.maintenanceExact,predictedWeight:moderateWeight,allowed:moderateAllowed,reason:moderateAllowed?'':moderateError||'При постоянном таком рационе модельный вес к дате оказывается ниже границы ИМТ 18,5. Выберите другой срок или индивидуальные нормы.'};
    const out={...common,moderate,deadline:null};
    if(profile.desiredWeight>=profile.weight){out.deadline={calories:null,allowed:false,reason:'Для сценария похудения желаемый вес должен быть ниже текущего.'};return out;}
    const weightAt=intake=>{try{return projectWeight(b,intake,days).weight;}catch{return -Infinity;}};
    const atFloor=weightAt(base.floor);
    if(atFloor>profile.desiredWeight+.0001){out.deadline={calories:null,allowed:false,reason:`Для этого веса к выбранной дате нужна калорийность ниже разрешённой границы ${base.floor} ккал. Увеличьте срок или измените цель.`,closestAtFloor:atFloor};return out;}
    let lo=base.floor,hi=base.maintenanceExact;
    for(let i=0;i<34;i++){const mid=(lo+hi)/2;if(weightAt(mid)>profile.desiredWeight)hi=mid;else lo=mid;}
    const calories=Math.min(Math.ceil((lo+hi)/2),Math.floor(base.maintenanceExact)),deficit=base.maintenanceExact-calories;
    const allowed=calories>=base.floor&&deficit<=base.maxDeficit+1e-8;
    out.deadline={calories,deficit,percent:100*deficit/base.maintenanceExact,predictedWeight:projectWeight(b,calories,days).weight,allowed,reason:allowed?'':`Для цели к сроку нужен дефицит больше допустимого (${Math.floor(base.maxDeficit)} ккал/сутки). Увеличьте срок или измените целевой вес.`};
    return out;
  }catch(error){return {...common,moderate:null,deadline:{calories:null,allowed:false,reason:error.message}};}
}
