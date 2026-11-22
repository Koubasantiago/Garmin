const Stream={fromByteArray:b=>b};
class Decoder{
  constructor(){}
  static isFIT(){return true;}
  read(){return {messages:{sessionMesgs:[{sport:'running',startTime:'2026-11-18T09:00:00Z',totalDistance:5000,totalTimerTime:1800,avgRunningCadence:86,avgHeartRate:148}],recordMesgs:[{timestamp:'2026-11-18T09:00:00Z',distance:0,cadence:85,heartRate:135},{timestamp:'2026-11-18T09:30:00Z',distance:5000,cadence:86,heartRate:155}]},errors:[]};}
}
import {cadenceSpm,migrateCadenceRun} from '../src/analysis.js';

const toNum = (value) => Number.isFinite(Number(value)) && value !== '' && value != null ? Number(value) : null;
const asDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
};
const avg = (items) => items.length ? items.reduce((a,b) => a + b, 0) / items.length : null;

function gcDistance(a, b) { // Haversine in meters.
  if (![a?.lat, a?.lon, b?.lat, b?.lon].every(Number.isFinite)) return 0;
  const rad = Math.PI / 180, dLat = (b.lat-a.lat)*rad, dLon = (b.lon-a.lon)*rad;
  const h = Math.sin(dLat/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}
function coord(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  const value = Number(v);
  return Math.abs(value) > 180 ? value * (180 / 2147483648) : value;
}
function decimate(points, max = 650) {
  if (points.length <= max) return points;
  const newPoints = [];
  for (let i=0; i<max; i++) newPoints.push(points[Math.round(i * (points.length-1) / (max-1))]);
  return newPoints;
}
function timeBetween(start, end) {
  return (asDate(end)?.getTime() ?? 0) - (asDate(start)?.getTime() ?? 0);
}
function normalizeRecords(rawPoints, startFallback) {
  let distance = 0, prev = null;
  const sorted = rawPoints.filter(p=>asDate(p.timestamp)).sort((a,b)=>timeBetween(b.timestamp,a.timestamp));
  const start = asDate(sorted[0]?.timestamp) || asDate(startFallback) || new Date();
  const points = [];
  for (const p of sorted) {
    const lat = Number.isFinite(p.lat) ? p.lat : null;
    const lon = Number.isFinite(p.lon) ? p.lon : null;
    const t = Math.max(0, (asDate(p.timestamp).getTime() - start.getTime()) / 1000);
    const measuredDistance = toNum(p.distance);
    if (measuredDistance != null && measuredDistance >= distance) distance = measuredDistance;
    else if (prev && lat != null && lon != null) {
      const step = gcDistance({lat,lon}, prev);
      if (step < 150) distance += step; // Ignore wild GPS jumps.
    }
    const hr = toNum(p.hr);
    const elev = toNum(p.elev);
    const cad = toNum(p.cadence);
    points.push({ t: Math.round(t), d: Math.round(distance), hr: hr != null && hr>0? Math.round(hr):null, elev, lat, lon, cadence: cad, speed: toNum(p.speed) });
    if (lat != null && lon != null) prev = {lat,lon};
  }
  return {start, points, distance};
}

function toRun({ fileName, source, date, distanceMeters, durationSeconds, avgHr, maxHr, cadence, ascent, points=[], laps=[] }) {
  const start = asDate(date);
  const km = Number(distanceMeters)/1000, seconds=Number(durationSeconds);
  if (!start || !Number.isFinite(km) || km < 0.08 || !Number.isFinite(seconds) || seconds < 10) {
    throw new Error('Soubor neobsahuje platný čas, vzdálenost nebo datum běhu.');
  }
  return {
    id: `${start.toISOString()}_${Math.round(distanceMeters)}_${Math.round(seconds)}`,
    cadenceSpmV:1, date: start.toISOString(), distanceKm: Math.round(km*1000)/1000, durationS: Math.round(seconds),
    avgHr: toNum(avgHr), maxHr: toNum(maxHr), cadence: toNum(cadence), ascent: toNum(ascent),
    fileName, source, points: decimate(points), laps: laps.filter(x => x.distanceKm > .08 && x.durationS > 10)
  };
}

async function parseFIT(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const stream = Stream.fromByteArray(bytes);
  if (!Decoder.isFIT(stream)) throw new Error('Soubor FIT má nesprávnou hlavičku.');
  const decoder = new Decoder(stream);
  const { messages, errors } = decoder.read();
  const session = messages.sessionMesgs?.find(m => !m.sport || String(m.sport).toLowerCase().includes('run')) || messages.sessionMesgs?.[0] || {};
  if (session.sport && !String(session.sport).toLowerCase().includes('run') && session.sport !== 'generic') {
    throw new Error('FIT obsahuje jiný sport než běh.');
  }
  const raw = (messages.recordMesgs || []).map(r => ({
    timestamp:r.timestamp, distance:r.distance, hr:r.heartRate,
    elev:r.enhancedAltitude ?? r.altitude, speed:r.enhancedSpeed ?? r.speed,
    cadence:cadenceSpm((toNum(r.cadence) ?? 0)+(toNum(r.fractionalCadence) ?? 0)), lat:coord(r.positionLat),lon:coord(r.positionLong)
  }));
  const parsed = normalizeRecords(raw, session.startTime || messages.activityMesgs?.[0]?.timestamp);
  const dur = toNum(session.totalTimerTime) ?? toNum(session.totalElapsedTime) ?? (parsed.points.at(-1)?.t ?? 0);
  const distance = toNum(session.totalDistance) ?? parsed.distance;
  const hrs = parsed.points.map(p => p.hr).filter(x => x != null);
  const start = asDate(session.startTime) || parsed.start;
  const laps = (messages.lapMesgs || []).map(l=>({
    distanceKm:(toNum(l.totalDistance)||0)/1000,
    durationS:toNum(l.totalTimerTime) ?? toNum(l.totalElapsedTime) ?? 0,
    avgHr:toNum(l.avgHeartRate)
  }));
  if (!distance && errors?.length) throw new Error('Data FIT nelze přečíst: ' + String(errors[0]).slice(0,100));
  return toRun({fileName:file.name,source:'FIT',date:start,distanceMeters:distance,durationSeconds:dur,avgHr:session.avgHeartRate ?? avg(hrs),maxHr:session.maxHeartRate ?? (hrs.length? Math.max(...hrs):null),cadence:cadenceSpm((toNum(session.avgRunningCadence) ?? toNum(session.avgCadence) ?? 0)+(toNum(session.avgFractionalCadence) ?? 0)),ascent:session.totalAscent,points:parsed.points,laps});
}

function xmlDoc(xml) {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.querySelector('parsererror')) throw new Error('Soubor XML není platný.');
  return dom;
}
const kids = (node, tag) => Array.from(node?.getElementsByTagName('*') || []).filter(x=>x.localName?.toLowerCase() === tag.toLowerCase());
const first = (node, tag) => kids(node, tag)[0];
const val = (node, tag) => first(node, tag)?.textContent?.trim() || null;

async function parseTCX(file) {
  const dom = xmlDoc(await file.text());
  const activity = first(dom,'Activity');
  if (!activity) throw new Error('TCX neobsahuje aktivitu.');
  const sport = activity.getAttribute('Sport');
  if (sport && !/run/i.test(sport)) throw new Error('TCX neobsahuje běžeckou aktivitu.');
  const trackPoints = kids(activity,'Trackpoint').map(p=>({
    timestamp:val(p,'Time'), distance:toNum(val(p,'DistanceMeters')),
    hr:toNum(val(p,'Value')), elev:toNum(val(p,'AltitudeMeters')),
    lat:toNum(val(p,'LatitudeDegrees')),lon:toNum(val(p,'LongitudeDegrees')),
    cadence:cadenceSpm(val(p,'RunCadence') ?? val(p,'Cadence')),speed:toNum(val(p,'Speed'))
  }));
  const parsed = normalizeRecords(trackPoints, val(activity,'Id'));
  const laps = kids(activity,'Lap').map(l=>({distanceKm:(toNum(val(l,'DistanceMeters'))||0)/1000,durationS:toNum(val(l,'TotalTimeSeconds'))||0,avgHr:toNum(val(first(l,'AverageHeartRateBpm'),'Value'))}));
  const distance = laps.reduce((sum,l)=>sum+l.distanceKm*1000,0) || parsed.distance;
  const dur = laps.reduce((sum,l)=>sum+l.durationS,0) || parsed.points.at(-1)?.t;
  const hrs = parsed.points.map(p=>p.hr).filter(x=>x!=null);
  const elevations = parsed.points.map(p=>p.elev).filter(x=>x!=null);
  const ascent = elevations.reduce((sum,v,i)=> i&&v>elevations[i-1] ? sum+v-elevations[i-1] :sum, 0);
  return toRun({fileName:file.name,source:'TCX',date:val(activity,'Id')||parsed.start,distanceMeters:distance,durationSeconds:dur,avgHr:avg(hrs),maxHr:hrs.length?Math.max(...hrs):null,cadence:avg(parsed.points.map(p=>p.cadence).filter(x=>x!=null)),ascent,points:parsed.points,laps});
}

async function parseGPX(file) {
  const dom = xmlDoc(await file.text());
  const pts = kids(dom,'trkpt');
  if (!pts.length) throw new Error('GPX neobsahuje záznamy trasy (trkpt).');
  const raw = pts.map(p => ({
    timestamp:val(p,'time'),lat:toNum(p.getAttribute('lat')),lon:toNum(p.getAttribute('lon')),
    elev:toNum(val(p,'ele')), hr:toNum(val(p,'hr')),cadence:cadenceSpm(val(p,'cad'))
  }));
  if (!raw.some(p=>p.timestamp)) throw new Error('GPX postrádá časové značky.');
  const parsed = normalizeRecords(raw);
  const hrs = parsed.points.map(p=>p.hr).filter(x=>x!=null);
  const elevations = parsed.points.map(p=>p.elev).filter(x=>x!=null);
  const ascent = elevations.reduce((sum,v,i)=>i&&v>elevations[i-1] ? sum+v-elevations[i-1] :sum,0);
  return toRun({fileName:file.name,source:'GPX',date:parsed.start,distanceMeters:parsed.distance,durationSeconds:parsed.points.at(-1)?.t,avgHr:avg(hrs),maxHr:hrs.length?Math.max(...hrs):null,cadence:avg(parsed.points.map(p=>p.cadence).filter(x=>x!=null)),ascent,points:parsed.points});
}

function splitCSV(text, sep) {
  const rows=[]; let row=[], part='', inside=false;
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if (c==='"') {if (inside && text[i+1]==='"') {part+='"'; i++;} else inside=!inside;}
    else if (c===sep && !inside) {row.push(part); part='';}
    else if ((c==='\r'||c==='\n') && !inside) {if (c==='\r'&&text[i+1]==='\n') i++;row.push(part);if(row.some(x=>x.trim()))rows.push(row);row=[];part='';}
    else part+=c;
  }
  row.push(part);if(row.some(x=>x.trim()))rows.push(row);
  return rows;
}
function parseNumeric(input) {
  if (input == null) return null;
  let s=String(input).trim().replace(/\s/g,'').replace(/[km%]/gi,'');
  if (!s || s==='--') return null;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',')>s.lastIndexOf('.') ? s.replace(/\./g,'').replace(',','.') : s.replace(/,/g,'');
  else if (s.includes(',')) s=s.replace(',','.');
  const n=Number(s);return Number.isFinite(n)?n:null;
}
export function parseDuration(value) {
  if (value == null) return null;
  const s=String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s); // raw seconds
  const parts=s.split(':').map(Number);
  if (![2,3].includes(parts.length) || !parts.every(Number.isFinite)|| parts.some(x=>x<0)) return null;
  if (parts.length===2) return parts[0]*60+parts[1];
  return parts[0]*3600+parts[1]*60+parts[2];
}
function parseCSVDate(value) {
  const s=String(value||'').trim();
  const common=asDate(s);if(common)return common;
  const m=s.match(/^(\d{1,2})[.\/]\s*(\d{1,2})[.\/]\s*(\d{4})(?:\s+(\d{1,2}):(\d\d)(?::(\d\d))?)?/);
  if(m)return new Date(Number(m[3]),Number(m[2])-1,Number(m[1]),Number(m[4]||12),Number(m[5]||0),Number(m[6]||0));
  return null;
}
async function parseCSV(file) {
  const text=(await file.text()).replace(/^\uFEFF/,'');
  const line=text.split(/\r?\n/)[0]||'';
  const sep=(line.match(/;/g)||[]).length>(line.match(/,/g)||[]).length?';':',';
  const rows=splitCSV(text,sep);
  if(rows.length<2)throw new Error('CSV neobsahuje tabulku aktivit.');
  const headers=rows.shift().map(s=>s.trim().toLowerCase());
  const index = (...terms)=>headers.findIndex(h=>terms.some(t=>h===t || h.includes(t)));
  const dateI=index('date','datum');const distanceI=index('distance','vzdálenost');const timeI=index('time','doba','čas');
  const sportI=index('activity type','typ aktivity','sport');const hrI=index('avg hr','average heart rate','průměrný tep');
  const ascentI=index('total ascent','celkové stoupání');const cadenceI=index('avg run cadence','average run cadence','průměrná kadence','avg cadence','cadence','kadence');
  if (dateI<0||distanceI<0||timeI<0) throw new Error('CSV nemá rozpoznatelné sloupce Datum, Vzdálenost a Čas. Nejlépe použij FIT nebo TCX.');
  const output=[];
  for(const cells of rows) {
    if(sportI>=0 && cells[sportI] && !/běh|running|run/i.test(cells[sportI]))continue;
    const date=parseCSVDate(cells[dateI]); const km=parseNumeric(cells[distanceI]);
    const duration=parseDuration(cells[timeI]);
    if(!date||!km||!duration) continue;
    try {output.push(toRun({fileName:file.name,source:'CSV',date,distanceMeters:km*1000,durationSeconds:duration,avgHr:hrI>=0?parseNumeric(cells[hrI]):null,ascent:ascentI>=0?parseNumeric(cells[ascentI]):null,cadence:cadenceI>=0?cadenceSpm(parseNumeric(cells[cadenceI])):null}));} catch { /* skip malformed row */ }
  }
  if(!output.length)throw new Error('V CSV nebyly rozpoznány žádné běžecké aktivity.');
  return output;
}

export async function parseFile(file) {
  const ext = file.name.split('.').at(-1).toLowerCase();
  if(file.size>40*1024*1024)throw new Error('Soubor je příliš velký (maximum 40 MB).');
  if(ext==='fit')return [await parseFIT(file)];
  if(ext==='tcx')return [await parseTCX(file)];
  if(ext==='gpx')return [await parseGPX(file)];
  if(ext==='csv')return await parseCSV(file);
  if(ext==='json'){
    const obj=JSON.parse(await file.text());
    const list=Array.isArray(obj)?obj:obj.runs;
    if(!Array.isArray(list))throw new Error('JSON není záloha Běžeckého kompasu.');
    const valid=list.filter(r=>r && asDate(r.date) && Number(r.distanceKm)>.08 && Number(r.durationS)>10)
      .map(r=>({...r, id:String(r.id || `${r.date}_${r.distanceKm}_${r.durationS}`),distanceKm:Number(r.distanceKm),durationS:Number(r.durationS),points:Array.isArray(r.points)?decimate(r.points):[],laps:Array.isArray(r.laps)?r.laps:[],source:r.source||'Záloha',fileName:r.fileName||'Záloha JSON'}));
    if(!valid.length)throw new Error('V záloze nebyly nalezeny platné běhy.');
    return valid.map(migrateCadenceRun);
  }
  throw new Error('Podporuji soubory .fit, .tcx, .gpx, .csv a .json.');
}

export function makeManualRun({date,km,seconds,hr,cadence}) {
  return toRun({fileName:'Ručně přidaný běh',source:'RUČNĚ',date:new Date(date),distanceMeters:km*1000,durationSeconds:seconds,avgHr:hr||null,cadence:cadence||null});
}
