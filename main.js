import './style.css';
import Chart from 'chart.js/auto';
import { parseFile, makeManualRun, parseDuration } from './parsers.js';
import {loadRuns, saveRun, deleteRun, clearRuns} from './storage.js';
import {ZONE_COLORS,ZONE_LABELS,ZONE_NAMES,runCadence,zoneBoundaries,zoneIndex,zoneSeconds,migrateCadenceRun} from './analysis.js';

const $=(id)=>document.getElementById(id);
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const round1=n=>(Math.round(n*10)/10).toLocaleString('cs-CZ',{maximumFractionDigits:1});
const fmtDate=(v,options={day:'numeric',month:'short',year:'numeric'})=>new Intl.DateTimeFormat('cs-CZ',options).format(new Date(v));
const fmtShort=v=>fmtDate(v,{day:'numeric',month:'numeric'});
const num=n=>Number.isFinite(Number(n)) && n!=null?Number(n):null;
function duration(seconds){
  if(!Number.isFinite(seconds)||seconds<0) return '–';
  const s=Math.round(seconds),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
  return h?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`;
}
function pace(secPerKm){return Number.isFinite(secPerKm)&&secPerKm>0&&secPerKm<3600?duration(secPerKm):'–';}
function paceOf(run){return run.distanceKm>0?run.durationS/run.distanceKm:null;}
function startOfWeek(date){const d=new Date(date);d.setHours(0,0,0,0);d.setDate(d.getDate()-(d.getDay()+6)%7);return d;}
function plusDays(date,n){const d=new Date(date);d.setDate(d.getDate()+n);return d;}
function sum(xs, fn=x=>x){return xs.reduce((acc,x)=>acc+(Number(fn(x))||0),0);}
let runs=[], selectedId=null, period='30', goal=Number(localStorage.getItem('bezecky-kompas-goal'))||20;
const DEFAULT_ZONES={maxHr:185,thresholds:[60,70,80,90]}; // Initial example, NOT a measured maximum.
function loadZoneSettings(){
  try{
    const x=JSON.parse(localStorage.getItem('bezecky-kompas-zone-settings'));
    if(x && Number.isFinite(x.maxHr) && x.maxHr>=120 && x.maxHr<=230 && Array.isArray(x.thresholds) && x.thresholds.length===4 && x.thresholds.every((n,i)=>Number.isFinite(n)&&n>=40&&n<=96&&(i===0||n>x.thresholds[i-1]+4)))return x;
  }catch{}
  return {...DEFAULT_ZONES,thresholds:[...DEFAULT_ZONES.thresholds]};
}
let zoneSettings=loadZoneSettings();
let charts={};let toastTimer;

function buildDemo(){
  const today=new Date();today.setHours(7,30,0,0);
  const specs=[[-43,4.8,34.2,153],[-36,6.3,43.4,149],[-29,5.2,34.2,146],[-24,7.3,48.3,150],[-18,4.5,28.7,143],[-13,8.1,52.4,145],[-8,5.4,34.0,144],[-4,6.2,38.1,141],[-1,9.0,56.2,147]];
  return specs.map(([days,km,min,hr],i)=>{
    const date=plusDays(today,days).toISOString();const seconds=min*60;
    const pts=Array.from({length:85},(_,j)=>({t:Math.round(seconds*j/84),d:Math.round(km*1000*j/84),hr:Math.round(hr-9+9*j/84+3*Math.sin(j/9)),cadence:Math.round(163+i+3*Math.sin(j/8)),elev:208+8*Math.sin(j/11),lat:null,lon:null}));
    return {id:`demo-${i}`,date,distanceKm:km,durationS:seconds,avgHr:hr,maxHr:hr+14,ascent:Math.round(km*7),cadence:163+i,source:'UKÁZKA',fileName:'Ukázkové údaje',points:pts,laps:[]};
  }).sort((a,b)=>b.date.localeCompare(a.date));
}
const currentRuns=()=>runs.length?runs:buildDemo();
const demo=()=>runs.length===0;
function filterPeriod(data){
  if(period==='all')return data;
  const floor=new Date();floor.setHours(0,0,0,0);floor.setDate(floor.getDate()-Number(period)+1);
  return data.filter(r=>new Date(r.date)>=floor);
}
function toast(msg,isError=false){
  const t=$('toast');clearTimeout(toastTimer);t.textContent=msg;t.classList.toggle('error',isError);t.classList.add('visible');toastTimer=setTimeout(()=>t.classList.remove('visible'),4700);
}
function setText(id,value){$(id).textContent=value;}
function weeklyKm(data){
  const current=startOfWeek(new Date());
  return Array.from({length:8},(_,i)=>{
    const week=plusDays(current, (i-7)*7), end=plusDays(week,7);
    return {label:fmtShort(week),km:sum(data.filter(r=>new Date(r.date)>=week&&new Date(r.date)<end),r=>r.distanceKm)};
  });
}
const colors={ticks:'#829eaa',line:'#304550',lime:'#d9fd71',aqua:'#65ddce'};
function chartDefaults(){return {responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{backgroundColor:'#0c1822',titleColor:'#e9f5f2',bodyColor:'#c2e9da',borderColor:'#42665c',borderWidth:1,padding:10}},scales:{x:{grid:{display:false},ticks:{color:colors.ticks,maxRotation:0,font:{size:10}}},y:{beginAtZero:true,grid:{color:colors.line},border:{display:false},ticks:{color:colors.ticks,font:{size:10}}}}}};
function resetChart(key,ctx,config){if(charts[key])charts[key].destroy();charts[key]=new Chart(ctx,config);}
function renderCharts(data){
  const weekly=weeklyKm(data);
  resetChart('weekly',$('weeklyChart'),{type:'bar',data:{labels:weekly.map(w=>w.label),datasets:[{data:weekly.map(w=>Number(w.km.toFixed(1))),backgroundColor:weekly.map((_,i)=>i===7?'#d9fd71':'#40625e'),hoverBackgroundColor:'#b9ed8e',borderRadius:6,barPercentage:.63,categoryPercentage:.95}]},options:{...chartDefaults(),plugins:{...chartDefaults().plugins,tooltip:{...chartDefaults().plugins.tooltip,callbacks:{label:c=>`${c.parsed.y.toLocaleString('cs-CZ')} km`}}},scales:{...chartDefaults().scales,y:{...chartDefaults().scales.y,ticks:{...chartDefaults().scales.y.ticks,callback:v=>`${v} km`}}}}});
  const past=data.slice().sort((a,b)=>a.date.localeCompare(b.date)).slice(-12);
  resetChart('pace',$('paceChart'),{type:'line',data:{labels:past.map(r=>fmtShort(r.date)),datasets:[{data:past.map(r=>Number((paceOf(r)/60).toFixed(2))),borderColor:'#65ddce',backgroundColor:'#65ddce20',borderWidth:2.7,tension:.35,fill:true,pointBackgroundColor:'#d9fd71',pointBorderColor:'#d9fd71',pointRadius:3,pointHoverRadius:5}]},options:{...chartDefaults(),plugins:{...chartDefaults().plugins,tooltip:{...chartDefaults().plugins.tooltip,callbacks:{label:c=>`${pace(Math.round(c.parsed.y*60))} min/km`}}},scales:{...chartDefaults().scales,y:{...chartDefaults().scales.y,beginAtZero:false,reverse:true,ticks:{...chartDefaults().scales.y.ticks,callback:v=>pace(Math.round(v*60))}}}}});
}
function validHeartRun(r){
  const hr=num(r.avgHr),p=paceOf(r),km=num(r.distanceKm),time=num(r.durationS);
  return hr!=null&&hr>=70&&hr<=215&&Number.isFinite(p)&&p>=210&&p<=900&&km>=2&&time>=600;
}
function matchingHeartRuns(data){
  const eligible=data.filter(validHeartRun).slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,100);
  let fallback=null;
  for(const anchor of eligible.slice(0,25)){
    const basePace=paceOf(anchor),slope=anchor.ascent!=null&&num(anchor.ascent)!=null?Number(anchor.ascent)/anchor.distanceKm:null;
    const matches=eligible.filter(r=>{
      const ratio=r.distanceKm/anchor.distanceKm;
      if(Math.abs(paceOf(r)-basePace)>Math.max(15,basePace*.045)||ratio<.75||ratio>1.33)return false;
      const otherSlope=r.ascent!=null&&num(r.ascent)!=null?Number(r.ascent)/r.distanceKm:null;
      return slope==null||otherSlope==null||Math.abs(otherSlope-slope)<=8;
    }).slice(0,12).sort((a,b)=>a.date.localeCompare(b.date));
    if(matches.length>=3)return {matches,eligible,comparable:true};
    if(matches.length>=2&&!fallback)fallback=matches;
  }
  return fallback?{matches:fallback,eligible,comparable:true}:{matches:eligible.slice(0,12).reverse(),eligible,comparable:false};
}
function renderHeartComparison(data){
  const result=matchingHeartRuns(data),series=result.matches;
  const validCount=result.eligible.length;
  const paired=result.comparable;
  const first=series[0],last=series[series.length-1];
  const tagline=$('hrCompareTag');
  tagline.textContent=paired?`${series.length} SROVNATELNÝCH BĚHŮ`:'CELKOVÝ PŘEHLED';
  const labels=series.map(r=>fmtShort(r.date));
  resetChart('heartCompare',$('hrCompareChart'),{type:'line',data:{labels,datasets:[{label:'Průměrný tep',data:series.map(r=>Number(r.avgHr)),borderColor:paired?'#65ddce':'#87a6ae',backgroundColor:paired?'#65ddce24':'#87a6ae12',fill:true,borderWidth:2.6,tension:.28,pointRadius:4,pointHoverRadius:6,pointBackgroundColor:paired?'#d9fd71':'#87a6ae',pointBorderColor:paired?'#d9fd71':'#87a6ae'}]},options:{...chartDefaults(),plugins:{...chartDefaults().plugins,tooltip:{...chartDefaults().plugins.tooltip,callbacks:{label:c=>`${Math.round(c.parsed.y)} tepů/min`,afterLabel:c=>`Tempo: ${pace(paceOf(series[c.dataIndex]))} min/km · ${round1(series[c.dataIndex].distanceKm)} km`}}},scales:{...chartDefaults().scales,y:{...chartDefaults().scales.y,beginAtZero:false,ticks:{...chartDefaults().scales.y.ticks,precision:0,callback:v=>`${v} bpm`}}}}});
  if(!validCount){
    setText('hrCompareDelta','–');setText('hrCompareSub','Zatím nejsou dostupná tepová data.');
    setText('hrCompareMessage','Nahraj běh z Garminu se zaznamenaným tepem (obvykle FIT nebo TCX), případně přidej průměrný tep ručně.');
    setText('hrCompareCriteria','Pro srovnání je potřeba alespoň 2 km běhu a záznam průměrného tepu.');
    return;
  }
  if(!paired){
    setText('hrCompareDelta','–');setText('hrCompareSub',`${validCount} běhů s použitelným tepem`);
    setText('hrCompareMessage','Graf ukazuje tep jednotlivých běhů. Zatím nejsou alespoň dva dost podobné na poctivé porovnání při stejném tempu.');
    setText('hrCompareCriteria','Pro srovnání hledáme podobné tempo (±4,5 %), vzdálenost a, pokud je známo, převýšení.');
    return;
  }
  const delta=Math.round(last.avgHr-first.avgHr),abs=Math.abs(delta);
  setText('hrCompareDelta',`${delta>0?'+':delta<0?'−':''}${abs} bpm`);
  setText('hrCompareSub',`${Math.round(first.avgHr)} → ${Math.round(last.avgHr)} bpm · ${fmtShort(first.date)} až ${fmtShort(last.date)}`);
  const comment=abs<5
    ?'Průměrný tep je u srovnatelných běhů podobný. Malý rozdíl sám o sobě neprokazuje změnu kondice.'
    :delta<0
      ?'Při podobném tempu byl poslední tep nižší. Může to ukazovat na lepší aerobní efektivitu, ale výsledek ověř na dalších bězích.'
      :'Při podobném tempu byl poslední tep vyšší. Mohou za tím být únava, horko či jiná zátěž; jeden trend neznamená zhoršení kondice.';
  setText('hrCompareMessage',comment+(series.length===2?' Srovnání zatím vychází pouze ze dvou běhů.':''));
  setText('hrCompareCriteria',`Srovnáváme ${series.length} běhy s podobným tempem (okolo ${pace(paceOf(last))} min/km), vzdáleností a dostupným převýšením. Tep je průměr za celý běh.`);
}


function usableCadenceValue(value){const n=num(value);return n!=null&&n>=80&&n<=260?n:null;}
function zoneRanges(){
  const b=zoneBoundaries(zoneSettings);
  return [`< ${b[0]}`,`${b[0]}–${b[1]-1}`,`${b[1]}–${b[2]-1}`,`${b[2]}–${b[3]-1}`,`${b[3]}+`];
}
function zoneRows(seconds){
  const total=sum(seconds),ranges=zoneRanges();
  return seconds.map((s,i)=>{
    const pct=total?s/total*100:0;
    return `<div class="zone-row"><span class="zone-label"><i style="background:${ZONE_COLORS[i]}"></i>${ZONE_LABELS[i]}</span><span class="zone-range">${ranges[i]} bpm</span><div class="zone-track"><span style="background:${ZONE_COLORS[i]};width:${pct.toFixed(2)}%"></span></div><strong class="zone-duration">${duration(s)} <small>(${Math.round(pct)} %)</small></strong></div>`;
  }).join('');
}
function renderZones(data){
  const parts=data.map(r=>zoneSeconds(r.points||[],zoneSettings));
  const seconds=[0,0,0,0,0];
  parts.forEach(p=>p.seconds.forEach((s,i)=>seconds[i]+=s));
  const total=sum(seconds);
  $('zoneRows').innerHTML=zoneRows(seconds);
  setText('zoneMaxLabel',`Zadané maximum ${zoneSettings.maxHr} bpm · zóny podle nastavení`);
  const hrRuns=data.filter(r=>num(r.avgHr)!=null&&r.avgHr>0);
  if(!total){
    setText('zoneHeadline','–');
    setText('zoneText',hrRuns.length?'Z aktivit je dostupný jen průměrný tep. Pro čas v zónách nahraj FIT, TCX nebo GPX s průběžnými hodnotami tepu.':'Nahraj soubor s průběžnými záznamy tepu a uvidíš, kolik času jsi strávil v každé z pěti zón.');
    setText('zoneCoverage','Žádný spolehlivý časový průběh tepu.');
    return;
  }
  const easy=seconds[0]+seconds[1],easyPct=Math.round(easy/total*100),main=seconds.indexOf(Math.max(...seconds));
  setText('zoneHeadline',`${easyPct} % v Z1–Z2`);
  setText('zoneText',easyPct>=70?'V zaznamenaném čase převažovalo lehčí úsilí. Pro vytrvalostní běhy to může být užitečné.':`Nejvíc zaznamenaného času připadá na ${ZONE_LABELS[main]} (${ZONE_NAMES[main].toLowerCase()} intenzita). Při hodnocení zohledni typ tréninku a správné hranice zón.`);
  setText('zoneCoverage',`Vyhodnoceno ${duration(total)} ze ${data.length} běhů. Chybějící tep a delší výpadky záznamu nejsou do procent započítány.`);
}
function renderCadence(data){
  const series=data.filter(r=>runCadence(r)!=null).slice().sort((a,b)=>a.date.localeCompare(b.date)).slice(-12);
  const values=series.map(r=>runCadence(r));
  resetChart('cadence',$('cadenceChart'),{type:'line',data:{labels:series.map(r=>fmtShort(r.date)),datasets:[{label:'Kadence (kroky/min)',data:values.map(v=>Number(v.toFixed(1))),borderColor:'#e5ca82',backgroundColor:'#e5ca821f',fill:true,pointRadius:4,pointBackgroundColor:'#d9fd71',borderWidth:2.7,tension:.25}]},options:{...chartDefaults(),plugins:{...chartDefaults().plugins,tooltip:{...chartDefaults().plugins.tooltip,callbacks:{label:c=>`${Math.round(c.parsed.y)} kroků/min`,afterLabel:c=>`Tempo: ${pace(paceOf(series[c.dataIndex]))} min/km`}}},scales:{...chartDefaults().scales,y:{...chartDefaults().scales.y,beginAtZero:false,ticks:{...chartDefaults().scales.y.ticks,callback:v=>`${v} spm`}}}}});
  if(!series.length){setText('cadenceAvg','–');setText('cadenceInfo','Zatím nemáš data o kadenci. Nejlépe je získáš importem FIT nebo TCX.');setText('cadenceDetailInfo','Kadence znamená kroky obou nohou za minutu (SPM).');return;}
  const weighted=sum(series,r=>runCadence(r)*r.durationS)/sum(series,r=>r.durationS);
  setText('cadenceAvg',`${Math.round(weighted)} spm`);
  setText('cadenceInfo',`${series.length} běhů s kadencí · nejnovější ${Math.round(values.at(-1))} spm.`);
  const paces=series.map(paceOf),minP=Math.min(...paces),maxP=Math.max(...paces);
  setText('cadenceDetailInfo',maxP-minP>25?'Kadence se často mění spolu s tempem. Pro smysluplné porovnání vyber běhy podobné rychlosti.':'Tempa vybraných běhů jsou relativně podobná; sleduj, zda se kadence mění postupně, ne jen po jednom běhu.');
}

function renderMetrics(selected){
  const dist=sum(selected,r=>r.distanceKm),secs=sum(selected,r=>r.durationS);
  const hrRuns=selected.filter(r=>num(r.avgHr)!=null&&r.avgHr>0);
  const hrWeight=sum(hrRuns,r=>r.durationS);
  const meanHr=hrWeight?sum(hrRuns,r=>r.avgHr*r.durationS)/hrWeight:null;
  setText('metricDistance',round1(dist));setText('metricPace',selected.length?pace(secs/dist):'–');
  setText('metricHr',meanHr?String(Math.round(meanHr)):'–');setText('metricRuns',String(selected.length));
  setText('metricDistanceNote',selected.length?`${duration(secs)} celkem`:'Zatím žádné aktivity');
  setText('metricPaceNote',selected.length?'Z celkové vzdálenosti a času':'Čeká na první běh');
  setText('metricHrNote',hrRuns.length?`Údaje z ${hrRuns.length} z ${selected.length} běhů`:'Tep zatím chybí');
  setText('metricRunsNote',selected.length?'Pravidelnost vítězí nad dokonalostí':'Začni prvním kilometrem');
}
function insight(icon,title,body,kind=''){return `<div class="insight-item"><div class="insight-icon ${kind}">${icon}</div><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></div></div>`;}
function renderInsights(data){
  const items=[];const realData=data.slice().sort((a,b)=>b.date.localeCompare(a.date));
  if(!realData.length){$('insights').innerHTML=insight('✳','Začni prvním během','Nahraj FIT, TCX nebo GPX. Až budeš mít více záznamů, uvidíš i trendy a doporučení.');return;}
  const now=new Date();const week=startOfWeek(now);const prev=plusDays(week,-7);
  const thisWeek=data.filter(r=>new Date(r.date)>=week);const lastWeek=data.filter(r=>new Date(r.date)>=prev&&new Date(r.date)<week);
  const wk=sum(thisWeek,r=>r.distanceKm),prevKm=sum(lastWeek,r=>r.distanceKm);
  if(wk>=goal)items.push(insight('✓','Týdenní cíl splněn',`Skvělé! Tento týden máš ${round1(wk)} km z cílových ${goal} km. Dopřej si prostor také na regeneraci.`));
  else items.push(insight('↗','Další malý krok',`Do týdenního cíle ti chybí ${round1(goal-wk)} km. Zvol si vzdálenost, která odpovídá tvému aktuálnímu stavu.`));
  if(wk>prevKm*1.25&&prevKm>=5)items.push(insight('!','Pozor na rychlé navyšování',`Objem vzrostl z ${round1(prevKm)} km minulý týden na ${round1(wk)} km nyní. Rychlý nárůst může zvyšovat zátěž; zařaď lehčí dny.`,'orange'));
  else if(prevKm>=5&&wk>0)items.push(insight('◎','Sleduj pravidelnost',`Minulý týden ${round1(prevKm)} km, zatím tento týden ${round1(wk)} km. Důležitější než jednorázový rekord je dlouhodobý rytmus.`,'blue'));
  else items.push(insight('◎','Konzistence je tvoje výhoda','Pokud se dostaneš ven i na kratší klus, buduješ návyk. Ne každý běh musí být rychlý.','blue'));
  if(realData.length>=6){
    const newer=realData.slice(0,3),older=realData.slice(3,6);
    const p1=sum(newer,r=>r.durationS)/sum(newer,r=>r.distanceKm),p0=sum(older,r=>r.durationS)/sum(older,r=>r.distanceKm);
    const diff=p0?((p0-p1)/p0)*100:0;
    if(diff>3)items.push(insight('↑','Tempo se zlepšuje',`Poslední tři běhy mají přibližně o ${Math.round(diff)} % rychlejší souhrnné tempo než předchozí tři. Zohledni ale také délku tras, terén a náročnost.`));
    else if(diff< -4)items.push(insight('♡','Pomalý běh má hodnotu','Poslední běhy jsou pomalejší. Nemusí to znamenat zhoršení; snadné tempo je běžná součást vytrvalostního tréninku.','blue'));
    else items.push(insight('→','Tempo držíš stabilně','Průměrná tempa posledních běhů se výrazně nemění. Pro posun sleduj také pocit z běhu a tep ve srovnatelných podmínkách.'));
  } else items.push(insight('⌁','První trendy vznikají','Po šesti a více bězích může aplikace začít porovnávat novější a starší tempo.','blue'));
  $('insights').innerHTML=items.slice(0,3).join('');
}
function renderGoal(data){
  const monday=startOfWeek(new Date());const weekKm=sum(data.filter(r=>new Date(r.date)>=monday),r=>r.distanceKm);
  const percent=Math.round(weekKm/goal*100);setText('weekDistance',round1(weekKm));setText('goalDistance',String(goal));setText('goalPercent',`${percent} %`);
  $('goalRing').style.setProperty('--fill',`${clamp(percent,0,100)}%`);
  setText('goalMessage',percent>=100?'Mise splněna! Každý další kilometr už je bonus.':percent>50?'Výborně! Každý další výběh tě posouvá k cíli.':'Soustřeď se na dnešní malý krok.');
}
function renderList(data){
  setText('totalCount',String(data.length));
  if(!data.length){$('runList').innerHTML='<div class="empty-state">Zatím tu nejsou žádné běhy. Nahraj první soubor Garmin nebo zapiš aktivitu ručně.</div>';return;}
  $('runList').innerHTML=data.map(r=>`<button type="button" class="run-row ${r.id===selectedId?'active':''}" data-id="${escapeHtml(r.id)}"><span class="run-badge">↗</span><span class="run-meta"><strong>${round1(r.distanceKm)} km · ${escapeHtml(r.source)}</strong><span>${escapeHtml(fmtDate(r.date))} · ${escapeHtml(duration(r.durationS))}</span></span><span class="run-numbers"><b>${pace(paceOf(r))}</b><small>min/km</small></span></button>`).join('');
  $('runList').querySelectorAll('.run-row').forEach(b=>b.addEventListener('click',()=>{selectedId=b.dataset.id;renderList(data);renderDetail(data);}));
}
function simpleRouteSvg(points){
  const gps=points.filter(p=>num(p.lat)!=null&&num(p.lon)!=null);
  if(gps.length<4)return '';
  const lat=gps.map(p=>p.lat),lon=gps.map(p=>p.lon);const minLat=Math.min(...lat),maxLat=Math.max(...lat),minLon=Math.min(...lon),maxLon=Math.max(...lon);
  const scaleX= Math.max(.000001,maxLon-minLon),scaleY=Math.max(.000001,maxLat-minLat);
  const pad=18,W=510,H=145;
  const adjustedX=scaleX*Math.cos(((maxLat+minLat)/2)*Math.PI/180);
  const scale=Math.min((W-2*pad)/Math.max(adjustedX,.000001),(H-2*pad)/scaleY);
  const halfWidth=adjustedX*scale/2,halfHeight=scaleY*scale/2;
  const cx=W/2,cy=H/2;
  const pairs=gps.map(p=>[cx+((p.lon-minLon)*Math.cos(((maxLat+minLat)/2)*Math.PI/180)*scale-halfWidth),cy-((p.lat-minLat)*scale-halfHeight)]);
  const path=pairs.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return `<div class="detail-subhead">NÁČRT GPS TRASY</div><div class="route-box"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Schematický náčrt zaznamenané trasy, bez mapového podkladu"><defs><linearGradient id="line" x1="0" x2="1"><stop stop-color="#65ddce"/><stop offset="1" stop-color="#d9fd71"/></linearGradient></defs><path d="${path}" fill="none" stroke="url(#line)" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${pairs[0][0]}" cy="${pairs[0][1]}" r="5" fill="#65ddce"/><circle cx="${pairs.at(-1)[0]}" cy="${pairs.at(-1)[1]}" r="5" fill="#d9fd71"/></svg></div><p class="help">Orientační tvar trasy, bez mapy a přesné navigace.</p>`;
}
function getSplitList(r){
  if(Array.isArray(r.laps)&&r.laps.length&&r.laps.every(x=>x.durationS>10))return r.laps.slice(0,20).map((l,i)=>`${i+1}. úsek ${round1(l.distanceKm)} km · ${pace(l.durationS/l.distanceKm)}`);
  const pts=r.points||[];if(pts.length<3)return [];
  const splits=[];let target=1000,lastT=0;
  for(let i=1;i<pts.length&&target<=r.distanceKm*1000;i++){
    const a=pts[i-1],b=pts[i];if(b.d<target||b.d<=a.d)continue;
    const t=a.t+(b.t-a.t)*(target-a.d)/(b.d-a.d);
    splits.push(`${splits.length+1}. km · ${pace(t-lastT)}`);lastT=t;target+=1000;
  }
  return splits.slice(0,20);
}
function renderDetail(data){
  const r=data.find(x=>x.id===selectedId)||data[0];
  if(!r){setText('detailTitle','Vyber běh');setText('detailDate','');$('runDetailBody').innerHTML='<div class="empty-state">Detail tréninku se zobrazí tady.</div>';$('removeRun').hidden=true;return;}
  selectedId=r.id;setText('detailTitle',`${round1(r.distanceKm)} km běh`);setText('detailDate',`${fmtDate(r.date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · ${r.source}`);
  $('removeRun').hidden=demo();
  const metrics=[['KADENCE',runCadence(r)!=null?`${Math.round(runCadence(r))} spm`:'–'],['TEMPO',`${pace(paceOf(r))} /km`],['ČAS',duration(r.durationS)],['TEP',r.avgHr?`${Math.round(r.avgHr)} bpm`:'–'],['STOUPÁNÍ',num(r.ascent)!=null?`${Math.round(r.ascent)} m`:'–']];
  const metricHtml=`<div class="detail-metrics">${metrics.map(([label,val])=>`<div class="detail-metric"><span>${label}</span><strong>${escapeHtml(val)}</strong></div>`).join('')}</div>`;
  const samples=r.points||[];
  let sampleHtml='';
  if(samples.length>6){sampleHtml='<div class="detail-subhead">VÝVOJ TEPU A TEMPA BĚHEM AKTIVITY</div><div class="detail-chart"><canvas id="detailChart"></canvas></div>';
  } else sampleHtml='<div class="no-samples">Tento záznam obsahuje jen souhrnné údaje. Podrobný graf tepu a tempa získáš typicky ze souboru FIT nebo TCX s průběžnými záznamy.</div>';
  const z=zoneSeconds(samples,zoneSettings);
  const zHtml=`<div class="detail-subhead">TEPOVÉ ZÓNY BĚHU</div><div class="zone-detail-note">${z.valid?`Vyhodnoceno ${duration(z.valid)} s dostupným tepem.`:(r.avgHr?`Průměrný tep ${Math.round(r.avgHr)} bpm spadá orientačně do ${zoneIndex(r.avgHr,zoneSettings)>=0?ZONE_LABELS[zoneIndex(r.avgHr,zoneSettings)]:'neznámé zóny'}, ale čas v zónách bez průběhu neurčíme.`:'Zatím nejsou dostupné průběžné údaje o tepu.')}</div><div class="zone-rows">${zoneRows(z.seconds)}</div>`;
  const cadencePts=samples.filter(p=>runCadence({cadence:p.cadence})!=null);
  const cadHtml=cadencePts.length>5?'<div class="detail-subhead">PRŮBĚH KADENCE BĚHEM BĚHU</div><div class="detail-chart"><canvas id="cadenceDetailChart" role="img" aria-label="Kadence v krocích za minutu během běhu"></canvas></div>':`<p class="help">${runCadence(r)!=null?'Dostupná je pouze souhrnná kadence; podrobný graf vyžaduje FIT nebo TCX s průběžnými záznamy.':'Kadence u tohoto běhu není zaznamenána.'}</p>`;
  const splits=getSplitList(r);
  $('runDetailBody').innerHTML=metricHtml+sampleHtml+zHtml+cadHtml+(splits.length?`<div class="detail-subhead">MEZIČASY</div><div class="splits">${splits.map(x=>`<span class="split-pill">${escapeHtml(x)}</span>`).join('')}</div>`:'')+simpleRouteSvg(samples)+`<p class="help">Zdroj: ${escapeHtml(r.fileName||r.source)} · Tempo a splity jsou orientační, mohou zahrnovat pauzy nebo GPS nepřesnosti.</p>`;
  if(charts.detail){charts.detail.destroy();charts.detail=null;}
  if(charts.cadenceDetail){charts.cadenceDetail.destroy();charts.cadenceDetail=null;}
  if(cadencePts.length>5){
    const selectedCad=cadencePts.filter((p,i)=>i%Math.max(1,Math.ceil(cadencePts.length/150))===0||i===cadencePts.length-1);
    resetChart('cadenceDetail',$('cadenceDetailChart'),{type:'line',data:{labels:selectedCad.map(p=>(p.d/1000).toFixed(1)),datasets:[{label:'Kadence (spm)',data:selectedCad.map(p=>usableCadenceValue(p.cadence)),borderColor:'#e5ca82',backgroundColor:'#e5ca821f',borderWidth:2,pointRadius:0,tension:.2,spanGaps:true,fill:true}]},options:{...chartDefaults(),plugins:{...chartDefaults().plugins,tooltip:{...chartDefaults().plugins.tooltip,callbacks:{title:items=>`${items[0]?.label} km`,label:c=>`${Math.round(c.parsed.y)} kroků/min`}}},scales:{...chartDefaults().scales,y:{...chartDefaults().scales.y,beginAtZero:false,ticks:{...chartDefaults().scales.y.ticks,callback:v=>`${v} spm`}}}}});
  }
  if(samples.length>6){
    const chartPts=samples.filter((p,i)=>i===0||i===samples.length-1||i%Math.max(1,Math.ceil(samples.length/120))===0);
    const paces=chartPts.map((p,i)=>{
      const prev=chartPts[Math.max(0,i-1)];const dd=p.d-prev.d,dt=p.t-prev.t;
      if(i===0)return null;
      const estimated=p.speed&&p.speed>1?1000/p.speed:(dd>3&&dt>0?dt*1000/dd:null);
      return estimated>=130&&estimated<=1200?Number((estimated/60).toFixed(2)):null;
    });
    const hearts=chartPts.map(p=>p.hr??null);
    const datasets=[];
    if(paces.some(x=>x!=null))datasets.push({label:'Tempo (min/km)',data:paces,borderColor:'#d9fd71',borderWidth:2,pointRadius:0,tension:.25,spanGaps:true,yAxisID:'pace'});
    if(hearts.some(x=>x!=null))datasets.push({label:'Tep (bpm)',data:hearts,borderColor:'#65ddce',borderWidth:2,pointRadius:0,tension:.25,spanGaps:true,yAxisID:'hr'});
    if(!datasets.length){$('detailChart').parentElement.outerHTML='<div class="no-samples">Průběhová data nejsou pro graf použitelná.</div>';}
    else{
      const scales={x:{grid:{display:false},ticks:{color:colors.ticks,font:{size:10},maxTicksLimit:6}},pace:{position:'left',display:datasets.some(d=>d.yAxisID==='pace'),reverse:true,grid:{color:colors.line},ticks:{color:colors.lime,font:{size:10},callback:v=>pace(v*60)}},hr:{position:'right',display:datasets.some(d=>d.yAxisID==='hr'),grid:{drawOnChartArea:false},ticks:{color:colors.aqua,font:{size:10}}}};
      resetChart('detail',$('detailChart'),{type:'line',data:{labels:chartPts.map(p=>(p.d/1000).toFixed(1)),datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#a7c0c5',boxWidth:10,font:{size:10}}},tooltip:{mode:'index',intersect:false,callbacks:{title:x=>`${x[0]?.label} km`}}},interaction:{mode:'index',intersect:false},scales}});
    }
  }
}
function render(){
  const data=currentRuns(),selected=filterPeriod(data);
  $('demoBanner').hidden=!demo();
  if(!selectedId||!data.some(r=>r.id===selectedId))selectedId=data[0]?.id||null;
  renderMetrics(selected);renderCharts(data);renderHeartComparison(data);renderZones(selected);renderCadence(selected);renderInsights(data);renderGoal(data);renderList(data);renderDetail(data);
}
function openFiles(){$('fileInput').click();}
async function importFiles(files){
  if(!files.length)return;
  let success=0,duplicates=0;const errors=[];
  const seen=new Set(runs.map(r=>r.id));
  for(const f of files){
    try{
      const imported=await parseFile(f);
      for(const r of imported){if(seen.has(r.id)){duplicates++;continue;}await saveRun(r);seen.add(r.id);runs.push(r);success++;}
    }catch(e){errors.push(`${f.name}: ${e.message}`);}
  }
  runs.sort((a,b)=>b.date.localeCompare(a.date));
  if(success)selectedId=runs[0].id;
  render();
  if(errors.length)toast(`${success} běhů přidáno, ${errors.length} souborů přeskočeno. ${errors[0]}`,true);
  else toast(success?`Úspěšně přidáno ${success} běhů${duplicates?` · ${duplicates} duplicit vynecháno`:''}.`:`Žádné nové běhy${duplicates?' (již nahrané soubory)':''}.`);
}
function exportBackup(){
  if(!runs.length){toast('Nejprve nahraj vlastní běhy. Ukázková data se nezálohují.',true);return;}
  const json=JSON.stringify({format:'bezecky-kompas-v1',exportedAt:new Date().toISOString(),runs},null,2);
  const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=`bezecky-kompas-zaloha-${new Date().toISOString().slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  toast('Záloha byla připravena ke stažení.');
}
function bindUI(){
  for(const id of ['uploadHero','uploadList'])$(id).addEventListener('click',openFiles);
  $('fileInput').addEventListener('change',async e=>{await importFiles([...e.target.files]);e.target.value='';});
  $('periodSelect').addEventListener('change',e=>{period=e.target.value;render();});
  $('addManual').addEventListener('click',()=>{
    const now=new Date();now.setMinutes(now.getMinutes()-now.getTimezoneOffset());$('manualDate').value=now.toISOString().slice(0,16);
    $('manualDialog').showModal();
  });
  $('manualForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const date=$('manualDate').value,km=Number($('manualDistance').value),seconds=parseDuration($('manualTime').value),hr=$('manualHr').value?Number($('manualHr').value):null,cadence=$('manualCadence').value?Number($('manualCadence').value):null;
    if(!Number.isFinite(km)||km<.1||!Number.isFinite(seconds)||seconds<10){toast('Zadej platnou vzdálenost a čas (například 32:15).',true);return;}
    try{const r=makeManualRun({date,km,seconds,hr,cadence});if(runs.some(x=>x.id===r.id)){toast('Tento běh už v deníku existuje.',true);return;}
      await saveRun(r);runs.push(r);runs.sort((a,b)=>b.date.localeCompare(a.date));selectedId=r.id;$('manualDialog').close();$('manualForm').reset();render();toast('Běh byl přidán.');
    }catch(err){toast(err.message,true);}
  });
  $('exportBackup').addEventListener('click',exportBackup);
  const settings=()=>{$('goalInput').value=goal;$('maxHrInput').value=zoneSettings.maxHr;zoneSettings.thresholds.forEach((v,i)=>$('zonePct'+(i+1)).value=v);$('settingsDialog').showModal();};
  $('openSettings').addEventListener('click',settings);$('editGoal').addEventListener('click',settings);$('editZones').addEventListener('click',settings);
  document.querySelectorAll('.dialog-close').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  $('saveSettings').addEventListener('click',()=>{
    const n=Number($('goalInput').value),maxHr=Number($('maxHrInput').value),limits=[1,2,3,4].map(i=>Number($('zonePct'+i).value));
    if(!Number.isFinite(n)||n<1||n>300){toast('Týdenní cíl musí být 1–300 km.',true);return;}
    if(!Number.isInteger(maxHr)||maxHr<120||maxHr>230){toast('Maximální tep musí být 120–230 bpm.',true);return;}
    if(limits.some((v,i)=>!Number.isInteger(v)||v<40||v>96||(i>0&&v<=limits[i-1]+4))){toast('Hranice zón nastav vzestupně, minimálně 5 procentních bodů od sebe.',true);return;}
    goal=n;zoneSettings={maxHr,thresholds:limits};
    localStorage.setItem('bezecky-kompas-goal',String(goal));localStorage.setItem('bezecky-kompas-zone-settings',JSON.stringify(zoneSettings));
    $('settingsDialog').close();render();toast('Cíle a tepové zóny byly uloženy.');
  });
  $('removeRun').addEventListener('click',async()=>{
    const r=runs.find(x=>x.id===selectedId);if(!r||!confirm(`Smazat běh ${round1(r.distanceKm)} km ze dne ${fmtDate(r.date)}?`))return;
    await deleteRun(r.id);runs=runs.filter(x=>x.id!==r.id);selectedId=runs[0]?.id||null;render();toast('Běh byl smazán.');
  });
  $('clearAll').addEventListener('click',async()=>{
    if(!confirm('Smazat všechny vlastní běhy z tohoto zařízení? Tuto akci nelze vrátit zpět. Předem doporučujeme zálohu JSON.'))return;
    await clearRuns();runs=[];selectedId=null;$('settingsDialog').close();render();toast('Všechny vlastní záznamy byly smazány.');
  });
  const hero=document.querySelector('.hero');
  ['dragenter','dragover'].forEach(type=>document.addEventListener(type,e=>{e.preventDefault();hero.style.outline='2px dashed #d9fd71';}));
  ['dragleave','drop'].forEach(type=>document.addEventListener(type,e=>{e.preventDefault();hero.style.outline='';}));
  document.addEventListener('drop',e=>{if(e.dataTransfer?.files?.length)importFiles([...e.dataTransfer.files]);});
}

async function init(){
  setText('todayLabel',fmtDate(new Date(),{day:'numeric',month:'long',year:'numeric'}).toUpperCase());
  bindUI();
  try{runs=(await loadRuns()).map(migrateCadenceRun);}catch(e){console.error(e);toast('Úložiště prohlížeče není dostupné. Zkus nepoužívat soukromý režim.',true);}
  render();
}
init();
