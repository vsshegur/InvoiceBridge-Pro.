/** Browser-only API adapter. It deliberately NEVER calls a backend with invoice content.
 * External libraries (PDF.js/XLSX/Tesseract) are lazily downloaded; OCR executes locally.
 */
import {get,all,put} from './storage.mjs';
import {COMPANIES,MAX_FILE_BYTES,MAX_PAGES,extractGuess,emptyReview,simpleCSVRows,parseTableRows,parseMasters,checkReview,checkExtraction,purchaseXML,clean,formatPaise} from './core.mjs';
const supported=new Set(['jpg','jpeg','png','webp','pdf','csv','xlsx','xls']);
const ext=file=>file.name.split('.').pop()?.toLowerCase()||'';
function content(body){return body instanceof FormData?body:typeof body==='string'?JSON.parse(body):body||{}}
async function sha256(file){const buf=await file.arrayBuffer(),hash=await crypto.subtle.digest('SHA-256',buf);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function jsonHash(value){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function sourceBlob(id){const d=await get('docs',id);return d?.file||null;}
const loaded={};async function script(url,key){if(loaded[key])return loaded[key];loaded[key]=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=url;s.async=true;s.crossOrigin='anonymous';s.onload=resolve;s.onerror=()=>{delete loaded[key];reject(Error(`${key} library could not load: internet may be required for first use.`))};document.head.append(s)});return loaded[key];}
const pdfjsURL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const pdfworkerURL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const xlsxURL='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const ocrURL='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let currentWorker=null,currentLang='',ocrProgressCallback=()=>{};
async function enhancedImage(file,onProgress=()=>{}){
 onProgress('Preparing enhanced photo for OCR…');
 const bitmap=await createImageBitmap(file),maxSide=Math.max(bitmap.width,bitmap.height),scale=Math.min(2,2400/maxSide);
 const w=Math.round(bitmap.width*scale),h=Math.round(bitmap.height*scale);
 if(!w||!h||w*h>7000000){bitmap.close();return file;}
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,w,h);bitmap.close();
 const img=ctx.getImageData(0,0,w,h),data=img.data;
 for(let i=0;i<data.length;i+=4){const gray=Math.min(255,Math.max(0,(0.299*data[i]+0.587*data[i+1]+0.114*data[i+2]-128)*1.5+128));data[i]=data[i+1]=data[i+2]=gray;}
 ctx.putImageData(img,0,0);
 const result=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.92));canvas.width=canvas.height=0;
 return result||file;
}
async function ocr(blob,onProgress=()=>{},{enhance=false}={}){
 ocrProgressCallback=onProgress;await script(ocrURL,'tesseract');const language=localStorage.getItem('ib_ocr_language')||'eng';
 if(!currentWorker||currentLang!==language){if(currentWorker){await currentWorker.terminate();currentWorker=null}onProgress('Loading OCR engine and '+language+' language data…');
  currentWorker=await Tesseract.createWorker(language,1,{logger:m=>{if(m.status==='recognizing text')ocrProgressCallback('OCR '+Math.floor((m.progress||0)*100)+'%')}});currentLang=language;}
 const source=enhance?await enhancedImage(blob,onProgress):blob;
 onProgress('Recognizing text on device…');
 const result=await currentWorker.recognize(source);
 return result.data.text||'';
}
/** Recover approximate visual lines from embedded PDF glyph positions instead of
 * flattening every page into one giant sentence (which hides invoice headers). */
function pdfLineText(items){
 const rows=[];
 for(const item of items){
  const text=String(item.str||'').trim();if(!text)continue;
  const x=Number(item.transform?.[4]||0),y=Number(item.transform?.[5]||0);
  let row=rows.find(r=>Math.abs(r.y-y)<2.5);
  if(!row){row={y,tokens:[]};rows.push(row)}row.tokens.push({x,text});
 }
 return rows.sort((a,b)=>b.y-a.y).map(r=>r.tokens.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' ')).join('\n');
}
async function readPDF(file,onProgress){await script(pdfjsURL,'pdfjs');pdfjsLib.GlobalWorkerOptions.workerSrc=pdfworkerURL;
 const pdf=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer()),useSystemFonts:true}).promise;const parts=[],notes=[];
 try{const limit=Math.min(pdf.numPages,MAX_PAGES);if(pdf.numPages>MAX_PAGES)notes.push(`PDF contains ${pdf.numPages} pages, only first ${MAX_PAGES} processed. Split file and verify.`);
 for(let i=1;i<=limit;i++){onProgress(`Reading PDF page ${i} of ${limit}`);const page=await pdf.getPage(i);const text=pdfLineText((await page.getTextContent()).items);
 if(text.trim().length>=70){parts.push(`--- PAGE ${i} ---\n${text}`);continue;}
 const viewport0=page.getViewport({scale:1});const scale=Math.min(1.6,Math.sqrt(4500000/(viewport0.width*viewport0.height)));const viewport=page.getViewport({scale});const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport}).promise;const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',0.85));canvas.width=canvas.height=0;
 if(!blob){notes.push(`Page ${i}: cannot render for OCR`);parts.push(`--- PAGE ${i} ---\n${text}`);continue}
 try{parts.push(`--- PAGE ${i} ---\n${await ocr(blob,onProgress)}`);notes.push(`Page ${i}: scanned-page OCR, review against original.`)}catch(err){parts.push(`--- PAGE ${i} ---\n${text}`);notes.push(`Page ${i}: OCR unavailable: ${err.message}`)}
 }
 notes.push('This version treats a PDF as one invoice. Split files containing multiple invoices.');return {raw:parts.join('\n'),notes};
 }finally{await pdf.destroy()}
}
async function readSheet(file){await script(xlsxURL,'xlsx');const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellFormula:false,cellHTML:false,cellDates:false});const parts=[],notes=['Spreadsheet values are hints; verify all formulas, layouts and totals.'];const allRows=[];
 for(const sheetName of workbook.SheetNames.slice(0,12)){const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,blankrows:false,defval:''});parts.push(`--- SHEET ${sheetName} ---`);allRows.push(...parseTableRows(rows));for(const row of rows.slice(0,1500)){parts.push(row.slice(0,25).map(v=>String(v??'').replace(/[\t\r\n]/g,' ')).join('\t'))}if(rows.length>1500)notes.push(`Sheet ${sheetName}: truncated at 1500 rows`)}return {raw:parts.join('\n').slice(0,150000),notes,rows:allRows.slice(0,120)};}
const REGIONS={
 header:{top:0.05,height:0.46},
 items:{top:0.30,height:0.48},
 totals:{top:0.53,height:0.39}
};
async function readRegion(bitmap,which,onProgress){
 const reg=REGIONS[which];const sy=Math.floor(bitmap.height*reg.top),sh=Math.max(1,Math.min(bitmap.height-sy,Math.ceil(bitmap.height*reg.height)));
 const sw=bitmap.width,scale=Math.min(2.6,2300/Math.max(sw,sh));const w=Math.max(1,Math.round(sw*scale)),h=Math.max(1,Math.round(sh*scale));
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,sy,sw,sh,0,0,w,h);
 const img=ctx.getImageData(0,0,w,h),d=img.data;
 for(let i=0;i<d.length;i+=4){const gray=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];const v=Math.min(255,Math.max(0,(gray-128)*1.33+128));d[i]=d[i+1]=d[i+2]=v;}
 ctx.putImageData(img,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.9));canvas.width=canvas.height=0;
 if(!blob)return '';
 onProgress(`Focused OCR: ${which}…`);
 await currentWorker.setParameters({tessedit_pageseg_mode:'6'});
 try{return (await currentWorker.recognize(blob)).data.text||'';}
 finally{await currentWorker.setParameters({tessedit_pageseg_mode:'3'});}
}
function mergeOCR(extracted){
 const review=extractGuess(extracted.raw,extracted.notes),notes=[];
 for(const [section,raw] of Object.entries(extracted.regions||{})){
  const hint=extractGuess(raw);
  for(const key of ['supplier_name','supplier_gstin','buyer_name','buyer_gstin','invoice_number','invoice_date','invoice_total','source_taxable','source_cgst','source_sgst','source_igst','round_off']){
   if(!clean(review[key])&&clean(hint[key])){review[key]=hint[key];notes.push(`${key.replaceAll('_',' ')} suggested from focused ${section} OCR; verify in photo.`);}
   else if(['invoice_number','invoice_date','invoice_total'].includes(key)&&clean(review[key])&&clean(hint[key])&&review[key]!==hint[key]){
    notes.push(`OCR disagreement for ${key.replaceAll('_',' ')}: full photo says ${review[key]}, ${section} scan says ${hint[key]}. Review original.`);
   }
  }
  if(section==='items'&&hint.lines.length){
   if(!review.lines.length){review.lines=hint.lines;notes.push('Item rows suggested from focused table OCR.');}
   else for(const row of review.lines){
    const match=hint.lines.find(x=>x.description.toLowerCase().replace(/\W/g,'')===row.description.toLowerCase().replace(/\W/g,''))||(review.lines.length===1&&hint.lines.length===1&&(row.hsn&&row.hsn===hint.lines[0].hsn||row.qty&&row.qty===hint.lines[0].qty)?hint.lines[0]:null);
    if(match)for(const key of ['hsn','source_amount','qty','unit','rate','gst_rate','discount'])if(!clean(row[key])&&clean(match[key]))row[key]=match[key];
   }
  }
  review.detected_gstins=[...new Set([...(review.detected_gstins||[]),...(hint.detected_gstins||[])])];
 }
 review.notes=[...(review.notes||[]),...notes];return review;
}
async function readDocument(file,onProgress,{enhance=false}={}){
 const type=ext(file);if(type==='pdf')return readPDF(file,onProgress);
 if(['jpg','jpeg','png','webp'].includes(type)){
  const notes=['On-device OCR. Printed and handwritten results must be verified with the original.'];
  try{
   const raw=(await ocr(file,onProgress,{enhance})).slice(0,150000),initial=extractGuess(raw),regions={};
   const core=['supplier_name','invoice_number','invoice_date','invoice_total'].filter(k=>!!initial[k]).length;
   const lowQuality=core<4||!initial.lines.length||initial.lines.some(x=>!x.source_amount)||!initial.source_cgst&&!initial.source_sgst;
   if(enhance||lowQuality){
    const targets=enhance?['header','items','totals']:[
     ...(!initial.invoice_number||!initial.invoice_date||!initial.supplier_name?['header']:[]),
     ...(!initial.lines.length||initial.lines.some(x=>!x.source_amount)?['items']:[]),
     ...(!initial.invoice_total?['totals']:[])
    ];
    if(targets.length){
     onProgress('Scanning missing invoice regions…');
     let bitmap=null;
     try{bitmap=await createImageBitmap(file);
      for(const area of targets){try{regions[area]=await readRegion(bitmap,area,onProgress)}catch(err){notes.push(`${area} focused scan unavailable: ${err.message}`);}}
     }catch(err){notes.push(`Focused OCR unavailable: ${err.message}`)}
     finally{bitmap?.close();}
    }
   }
   return {raw,notes,regions};
  }catch(err){notes.push('OCR error: '+err.message+'; enter invoice details manually.');return {raw:'',notes,regions:{}};}
 }
 if(['xlsx','xls'].includes(type))return readSheet(file);
 if(type==='csv')return {raw:(await file.text()).slice(0,150000),notes:['CSV read directly. Verify column mapping and amount values.']};
 throw Error('Unsupported file type');
}
function extractionMeta(raw,review,notes=[]){
 const chars=(raw||'').trim().length,fields=['supplier_name','invoice_number','invoice_date','invoice_total'].filter(k=>!!review[k]).length;
 const error=notes.find(x=>/OCR error|Parser error|OCR unavailable/i.test(x))||'';
 return {state:error||chars<25?'failed':fields<4||!review.lines?.length||review.lines.some(x=>!x.source_amount)?'partial':'read',characters:chars,fields,items:review.lines?.length||0,error};
}
async function uploadInvoice(company,file,onProgress=()=>{}){
 if(!COMPANIES[company])throw Error('Unknown Tally company');if(!file||!supported.has(ext(file)))throw Error('Choose a JPG, PNG, PDF, XLS, XLSX or CSV invoice');if(!file.size||file.size>MAX_FILE_BYTES)throw Error('Invoice must be between 1 byte and 15 MB');
 const hash=await sha256(file);const previous=(await all('docs')).find(x=>x.company===company&&x.source_sha===hash);if(previous)throw Error(`File already imported in this company: ${previous.filename}`);
 let extracted;try{extracted=await readDocument(file,onProgress)}catch(err){extracted={raw:'',notes:['Parser error: '+err.message+'; review source and type values manually.']}};
 const review=mergeOCR(extracted);if(extracted.rows?.length)review.lines=extracted.rows;if(ext(file)==='csv'){review.lines=simpleCSVRows(extracted.raw);if(!review.supplier_name)review.supplier_name=extracted.raw.split(/\r?\n/)[0]?.split(',')[1]?.trim()||'';}
 const id=crypto.randomUUID(),doc={id,company,filename:file.name,suffix:'.'+ext(file),source_sha:hash,file,raw_text:extracted.raw,ocr_details:extracted.regions||{},review,extraction:extractionMeta(extracted.raw,review,extracted.notes),status:'draft',created:Date.now(),approved:null,approval_hash:null,exported:null};await put('docs',doc);return {id};
}
const companyDocs=async company=>(await all('docs')).filter(d=>d.company===company).sort((a,b)=>b.created-a.created);
export async function installDemo(company='vipul'){const txt=await (await fetch('./examples/demo_masters.xml')).text();const ms=parseMasters(txt);await put('masters',{id:company,rows:ms});const csv=await (await fetch('./examples/demo_invoice.csv')).text();const file=new File([csv],'demo_invoice.csv',{type:'text/csv'});
 try{return await uploadInvoice(company,file)}catch(err){if(/already imported/i.test(err.message)){const d=(await companyDocs(company)).find(d=>d.filename==='demo_invoice.csv');if(d)return {id:d.id};}throw err;}}
export async function downloadBackup(){const [docs,masters,aliases]=await Promise.all([all('docs'),all('masters'),all('aliases')]);const safeDocs=docs.map(({file,...rest})=>rest);return new Blob([JSON.stringify({version:1,created:new Date().toISOString(),docs:safeDocs,masters,aliases,warning:'Original source files are NOT included. This is NOT a complete backup.'},null,2)],{type:'application/json'});}
export async function diagnosticText(){const docs=await all('docs');return `InvoiceBridge Mobile v0.7.0\nUser agent: ${navigator.userAgent}\nOnline: ${navigator.onLine}\nDocuments saved on this device: ${docs.length}\nStorage API: ${!!indexedDB}\nNo invoice contents included.`}
export async function localAPI(path,options={}){const {method='GET',body}=options;const url=new URL(path,location.origin),segments=url.pathname.split('/').filter(Boolean),company=url.searchParams.get('company');
 if(url.pathname==='/api/me')return {user:'local device'};
 if(url.pathname==='/api/masters'&&method==='GET'){if(!COMPANIES[company])throw Error('Unknown company');return {masters:(await get('masters',company))?.rows||[]};}
 if(url.pathname==='/api/docs'&&method==='GET'){if(!COMPANIES[company])throw Error('Unknown company');return {docs:(await companyDocs(company)).map(d=>({id:d.id,company:d.company,filename:d.filename,supplier:d.review.supplier_name,invoice_number:d.review.invoice_number,status:d.status,extraction_verified:!!d.extraction_verified,created:d.created}))};}
 if(url.pathname==='/api/masters/import'&&method==='POST'){const form=content(body),co=form.get('company'),file=form.get('file');if(!COMPANIES[co]||!file)throw Error('Select a company and master XML file');if(file.size>20*1024*1024||!/^.*\.xml$/i.test(file.name))throw Error('Use a Tally export XML under 20 MB');const rows=parseMasters(await file.text());await put('masters',{id:co,rows});return {ledger_count:rows.filter(x=>x.kind==='ledger').length,stock_count:rows.filter(x=>x.kind==='stock').length};}
 if(url.pathname==='/api/docs/upload'&&method==='POST'){const form=content(body);return uploadInvoice(form.get('company'),form.get('file'),msg=>{const s=document.getElementById('uploadStatus');if(s)s.textContent=msg})}
 if(segments[0]==='api'&&segments[1]==='docs'&&segments[2]){const id=segments[2],doc=await get('docs',id);if(!doc)throw Error('Invoice not found on this device');
  if(segments.length===3&&method==='GET'){const aliases=(await all('aliases')).filter(a=>a.company===doc.company);return {document:doc,aliases,supplier_suggestions:[]};}
  if(segments[3]==='reextract'&&method==='POST'){
   if(doc.status==='exported')throw Error('Exported invoice is locked. Reimport separately to reprocess.');
   if(!doc.file)throw Error('Original invoice is missing on this device');
   const existing=extractGuess(doc.raw_text||'');
   const quickHits=['supplier_name','invoice_number','invoice_date','invoice_total'].filter(k=>!!existing[k]).length;
   const type=ext(doc.file);const rescan=['jpg','jpeg','png','webp'].includes(type);const result=quickHits>=2&&!rescan?{raw:doc.raw_text,notes:['Reparsed existing recognized text; no slow OCR download needed.']}:await readDocument(doc.file,message=>{const el=document.getElementById('ocrStatusText');if(el)el.textContent=message;},{enhance:true});
   const oldText=doc.raw_text||'';const oldInfo=extractGuess(oldText);const newInfo=mergeOCR(result);const hits=x=>['supplier_name','invoice_number','invoice_date','invoice_total'].filter(k=>!!x[k]).length;const useOld=hits(oldInfo)>hits(newInfo)&&oldText.trim().length>result.raw.trim().length;const chosen=useOld?{raw:oldText,notes:[...result.notes,'Enhanced OCR was weaker; previous recognized text was retained.']}:result;const guessed=useOld?oldInfo:newInfo;
   // OCR is only a suggestion: never overwrite reviewer-entered values or accepted Tally masters.
   const next={...doc.review};for(const key of ['supplier_name','invoice_number','invoice_date','invoice_total'])if((!clean(next[key])||next[key]===oldInfo[key])&&clean(guessed[key]))next[key]=guessed[key];
   if((!(next.lines||[]).length||JSON.stringify(next.lines)===JSON.stringify(oldInfo.lines))&&guessed.lines.length)next.lines=guessed.lines;
   else if(guessed.lines.length)for(const row of next.lines||[]){const updated=guessed.lines.find(x=>x.description.toLowerCase().replace(/\W/g,'')===row.description.toLowerCase().replace(/\W/g,''));const before=oldInfo.lines?.find(x=>x.description.toLowerCase().replace(/\W/g,'')===row.description.toLowerCase().replace(/\W/g,''));if(updated)for(const key of ['hsn','qty','rate','unit','source_amount','discount','gst_rate'])if((!clean(row[key])||before&&row[key]===before[key])&&clean(updated[key]))row[key]=updated[key];}
   for(const key of ['source_taxable','source_cgst','source_sgst','source_igst','supplier_gstin','buyer_name','buyer_gstin','round_off'])if((!clean(next[key])||next[key]===oldInfo[key])&&clean(guessed[key]))next[key]=guessed[key];
   next.detected_gstins=[...new Set([...(next.detected_gstins||[]),...guessed.detected_gstins])];
   next.notes=[...(next.notes||[]),...guessed.notes];
   doc.raw_text=chosen.raw;doc.ocr_details=useOld?doc.ocr_details||{}:result.regions||{};doc.review=next;doc.extraction=extractionMeta(chosen.raw,guessed,chosen.notes);doc.status='draft';doc.approved=null;doc.approval_hash=null;doc.extraction_verified=null;doc.extraction_verify_hash=null;
   await put('docs',doc);return {document:doc,extraction:doc.extraction};
  }
  if(segments[3]==='review'&&method==='POST'){if(doc.status==='exported')throw Error('Exported draft is locked to preserve the review audit trail');const v=content(body);doc.review=v;doc.status='draft';doc.approved=null;doc.approval_hash=null;doc.extraction_verified=null;doc.extraction_verify_hash=null;await put('docs',doc);return {saved:true};}
  if(segments[3]==='validate-extraction'&&method==='POST'){const x=checkExtraction(doc.review,await companyDocs(doc.company),id);return {valid:x.valid,errors:x.errors,warnings:x.warnings,calculation:x.calculation?{totals:Object.fromEntries(Object.entries(x.calculation.totals).map(([k,v])=>[k,formatPaise(v)]))}:null};}
  if(segments[3]==='verify-extraction'&&method==='POST'){if(doc.status==='exported')throw Error('Exported invoice cannot be changed');const x=checkExtraction(doc.review,await companyDocs(doc.company),id);if(!x.valid)throw Error('Complete extracted fields first: '+x.errors.join('; '));doc.extraction_verified=Date.now();doc.extraction_verify_hash=await jsonHash(doc.review);await put('docs',doc);return {verified:true,warnings:x.warnings};}
  if(segments[3]==='validate'&&method==='POST'){const allDocs=await companyDocs(doc.company),masters=(await get('masters',doc.company))?.rows||[];const result=checkReview(doc.review,masters,allDocs,id);return {valid:result.valid,errors:result.errors,calculation:result.calculation?{totals:Object.fromEntries(Object.entries(result.calculation.totals).map(([k,v])=>[k,formatPaise(v)]))}:null};}
  if(segments[3]==='approve'&&method==='POST'){if(doc.status==='exported')throw Error('Exported voucher cannot be reapproved');if(!doc.extraction_verified||doc.extraction_verify_hash!==(await jsonHash(doc.review)))throw Error('Verify extracted invoice data first, before Tally voucher approval');const masters=(await get('masters',doc.company))?.rows||[];const check=checkReview(doc.review,masters,await companyDocs(doc.company),id);if(!check.valid)throw Error('Review failed:\n'+check.errors.join('\n'));doc.status='approved';doc.approved=Date.now();doc.approval_hash=await jsonHash(doc.review);await put('docs',doc);return {approved:true};}
  if(segments[3]==='xml'&&method==='GET'){if(!['approved','exported'].includes(doc.status)||doc.approval_hash!==(await jsonHash(doc.review)))throw Error('This document has not been approved for export');const masters=(await get('masters',doc.company))?.rows||[];const check=checkReview(doc.review,masters,await companyDocs(doc.company),id);if(!check.valid)throw Error('Approval no longer valid: '+check.errors.join('; '));const output=purchaseXML(doc.review,COMPANIES[doc.company]);doc.status='exported';doc.exported=Date.now();await put('docs',doc);return new Response(new Blob([output],{type:'application/xml'}),{headers:{'content-type':'application/xml'}});}
 }
 throw Error(`Unsupported local operation: ${method} ${path}`);
}
