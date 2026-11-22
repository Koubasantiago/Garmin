const DB_NAME='bezecky-kompas-db';
const STORE='runs';
function dbOpen() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'id'});};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function dbOperation(mode, callback){
  const db=await dbOpen();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode);const request=callback(tx.objectStore(STORE));
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    tx.oncomplete=()=>db.close();
    tx.onerror=()=>{db.close();reject(tx.error);};
  });
}
export async function loadRuns(){return (await dbOperation('readonly',st=>st.getAll())).sort((a,b)=>b.date.localeCompare(a.date));}
export async function saveRun(run){return dbOperation('readwrite',st=>st.put(run));}
export async function deleteRun(id){return dbOperation('readwrite',st=>st.delete(id));}
export async function clearRuns(){return dbOperation('readwrite',st=>st.clear());}
