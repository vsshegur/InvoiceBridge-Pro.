/** Persistent *this-device-only* IndexedDB: no cloud requests or account sync. */
const DB_NAME='invoicebridge-mobile-v1';let dbPromise;
function open(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
 const request=indexedDB.open(DB_NAME,1);
 request.onupgradeneeded=()=>{const db=request.result;for(const s of ['docs','masters','aliases','audit'])if(!db.objectStoreNames.contains(s))db.createObjectStore(s,{keyPath:'id'});};
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });return dbPromise;}
export async function get(store,id){const db=await open();return new Promise((res,rej)=>{const rq=db.transaction(store,'readonly').objectStore(store).get(id);rq.onsuccess=()=>res(rq.result||null);rq.onerror=()=>rej(rq.error)});}
export async function all(store){const db=await open();return new Promise((res,rej)=>{const rq=db.transaction(store,'readonly').objectStore(store).getAll();rq.onsuccess=()=>res(rq.result||[]);rq.onerror=()=>rej(rq.error)});}
export async function put(store,value){const db=await open();return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error)});}
export async function drop(store,id){const db=await open();return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(id);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error)});}
