/** Pure calculations shared between charts, FIT/TCX importing and tests. */
export const ZONE_COLORS=['#65ddce','#a9dc80','#d9fd71','#ffcc7a','#ff867f'];
export const ZONE_LABELS=['Z1','Z2','Z3','Z4','Z5'];
export const ZONE_NAMES=['Velmi lehká','Lehká','Střední','Vysoká','Velmi vysoká'];

// FIT running cadence is usually stride cycles/min (one step from each foot).
// Garmin Connect and the UI show the total number of foot strikes/min (SPM).
// TCX RunCadence is likewise often strides/min. Export formats vary.
export function cadenceSpm(input){
  const v=Number(input);
  if(input==null||input===''||!Number.isFinite(v)||v<=0)return null;
  const spm=v<120?v*2:v;
  return spm>=80&&spm<=260?Math.round(spm*10)/10:null;
}
export function usableCadence(input){
  const v=Number(input);
  return input!=null&&input!==''&&Number.isFinite(v)&&v>=80&&v<=260?v:null;
}
export function runCadence(run){
  const direct=usableCadence(run.cadence);
  if(direct!=null)return direct;
  const samples=(run.points||[]).map(p=>usableCadence(p.cadence)).filter(v=>v!=null);
  return samples.length?samples.reduce((a,b)=>a+b,0)/samples.length:null;
}
export function zoneBoundaries(settings){
  return settings.thresholds.map(p=>Math.ceil(settings.maxHr*p/100));
}
export function zoneIndex(hr,settings){
  if(hr==null||!Number.isFinite(Number(hr))||Number(hr)<35||Number(hr)>240)return -1;
  const limits=zoneBoundaries(settings);
  const index=limits.findIndex(bound=>Number(hr)<bound);
  return index<0?4:index;
}
// An interval is assigned to the HR sample at its start. Ignore missing HR
// and gaps over 60 seconds (autopause or missing FIT smart recordings).
// Import preserves timestamps even when point lists are reduced for graphing.
export function zoneSeconds(points,settings){
  const seconds=[0,0,0,0,0];let valid=0;
  for(let i=0;i<(points?.length||0)-1;i++){
    const a=points[i],b=points[i+1],dt=Number(b.t)-Number(a.t);
    if(!Number.isFinite(dt)||dt<=0||dt>60)continue;
    const idx=zoneIndex(a.hr,settings);
    if(idx<0)continue;
    seconds[idx]+=dt;valid+=dt;
  }
  return {seconds,valid};
}

// Earlier versions kept raw FIT cadence (often half the SPM shown by Garmin).
// Convert only old records; marked records are never converted twice.
export function migrateCadenceRun(run){
  if(run.cadenceSpmV===1)return run;
  return {...run,cadence:cadenceSpm(run.cadence),points:(run.points||[]).map(p=>({...p,cadence:cadenceSpm(p.cadence)})),cadenceSpmV:1};
}
