import {localAPI,sourceBlob,installDemo,downloadBackup,diagnosticText} from './src/local-api.mjs';
'use strict';
const $=id=>document.getElementById(id);
let docs=[], masters=[], currentDoc=null, selectedDocId=null, dirty=false, lastSavedReviewJson="";
let company=localStorage.getItem('ib_company')==='vijayalaxmi'?'vijayalaxmi':'vipul';
const htmlEsc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const msg=(s,mode='')=>{const el=$('feedback');el.textContent=s;el.className='feedback '+mode;el.hidden=false};
const snack=s=>{const el=$('snackbar');el.textContent=s;el.classList.add('visible');setTimeout(()=>el.classList.remove('visible'),3600)};
async function api(path,options={}){return localAPI(path,options);}
async function init(){try{await api('/api/me');$('shell').hidden=false;$('loginScreen').hidden=true;$('companySelect').value=company;await refresh();}catch{$('loginScreen').hidden=false;$('shell').hidden=true}}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginError').textContent='';try{await api('/api/login',{method:'POST',body:JSON.stringify({password:$('adminPassword').value})});$('adminPassword').value='';await init()}catch(err){$('loginError').textContent=err.message}});
$('logoutBtn').onclick=async()=>{try{await navigator.clipboard.writeText(await diagnosticText());snack('Safe technical diagnostics copied. Paste them when reporting a bug.')}catch(e){snack('Diagnostics copy unavailable: '+e.message)}};
$('companySelect').onchange=async e=>{company=e.target.value;localStorage.setItem('ib_company',company);currentDoc=null;selectedDocId=null;$('reviewScreen').hidden=true;$('emptyState').hidden=false;await refresh()};
async function refresh(){const [m,d]=await Promise.all([api('/api/masters?company='+company),api('/api/docs?company='+company)]);masters=m.masters;docs=d.docs;$('masterCount').textContent=`${masters.filter(x=>x.kind==='ledger').length} ledgers · ${masters.filter(x=>x.kind==='stock').length} stock items`;$('docCount').textContent=docs.length;renderList();renderChoices();}
function renderList(){$('docList').innerHTML=docs.length?docs.map(d=>`<div class="queue-item ${selectedDocId===d.id?'active':''}" data-id="${htmlEsc(d.id)}"><div class="name">${htmlEsc(d.supplier||d.filename)}</div><div class="meta"><span>${htmlEsc(d.invoice_number||'Unverified invoice')}</span><span><span class="dot ${htmlEsc(d.status)}"></span>${htmlEsc(d.extraction_verified&&d.status==='draft'?'verified':d.status)}</span></div></div>`).join(''):'<div class="empty-mini">No invoices uploaded.</div>';[...$('docList').querySelectorAll('.queue-item')].forEach(e=>e.onclick=()=>openDoc(e.dataset.id))}
function renderChoices(){const ledgers=masters.filter(x=>x.kind==='ledger');$('ledgerChoices').innerHTML=ledgers.map(x=>`<option value="${htmlEsc(x.name)}"></option>`).join('');const groupParents=Object.fromEntries(masters.filter(x=>x.kind==='group').map(x=>[x.name.toLowerCase(),(x.parent||'').toLowerCase()]));const isCreditor=x=>{let p=(x.parent||'').toLowerCase();const seen=new Set();while(p&&!seen.has(p)){if(p==='sundry creditors')return true;seen.add(p);p=groupParents[p]||''}return false};$('supplierChoices').innerHTML=ledgers.filter(isCreditor).map(x=>`<option value="${htmlEsc(x.name)}"></option>`).join('');$('stockChoices').innerHTML=masters.filter(x=>x.kind==='stock').map(x=>`<option value="${htmlEsc(x.name)}"></option>`).join('');}
$('invoiceFile').onchange=async e=>{const files=[...(e.target.files||[])];if(!files.length)return;$('uploadStatus').hidden=false;let lastId=null,success=0,errors=[];for(const [idx,file] of files.entries()){const fd=new FormData();fd.append('company',company);fd.append('file',file);$('uploadStatus').textContent=`Processing ${idx+1}/${files.length}: ${file.name} (on this device)…`;try{const result=await api('/api/docs/upload',{method:'POST',body:fd});lastId=result.id;success++}catch(err){errors.push(`${file.name}: ${err.message}`)}}$('uploadStatus').textContent=`Imported ${success}/${files.length} draft(s). ${errors.join('; ')} Open the OCR status on each invoice and verify suggested fields.`;await refresh();if(lastId)await openDoc(lastId);e.target.value=''};
$('cameraFile').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;const fd=new FormData();fd.append('company',company);fd.append('file',f);$('uploadStatus').hidden=false;$('uploadStatus').textContent='Reading photo locally…';try{const result=await api('/api/docs/upload',{method:'POST',body:fd});await refresh();await openDoc(result.id);$('uploadStatus').textContent='Photo saved as unapproved draft. Check the OCR status and verify fields.';}catch(err){$('uploadStatus').textContent=err.message;}e.target.value=''};
$('masterFile').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;const fd=new FormData();fd.append('company',company);fd.append('file',file);try{const data=await api('/api/masters/import',{method:'POST',body:fd});snack(`Imported ${data.ledger_count} ledgers and ${data.stock_count} stock items`);await refresh();if(currentDoc)await openDoc(currentDoc.document.id)}catch(err){snack(err.message)}e.target.value=''};
function formVal(name,value){const el=$('reviewForm').elements.namedItem(name);if(el&&'value'in el)el.value=value??''}
async function openDoc(id){try{const result=await api('/api/docs/'+id);currentDoc=result;selectedDocId=id;$('emptyState').hidden=true;$('reviewScreen').hidden=false;renderList();const d=result.document;const review=d.review;$('reviewForm').reset();$('reviewTitle').textContent=review.invoice_number?'Invoice '+review.invoice_number:'Invoice review';$('documentInfo').textContent=`${d.filename} · ${d.company==='vipul'?'VIPUL TEXTILES':'VIJAYALAXMI TEXTILES'}`;Object.keys(review).forEach(k=>{if(!['lines','notes','detected_gstins'].includes(k))formVal(k,review[k])});renderLines(review.lines);lastSavedReviewJson=JSON.stringify(reviewPayload());$('rawText').textContent=d.raw_text||'No readable text detected. Fill fields using the original invoice.';renderExtraction(d);await renderPreview(d);updateStatus(d);$('feedback').hidden=true;const aliases=result.aliases||[];const alias=(name,kind)=>aliases.find(x=>x.kind===kind&&x.alias===(name||'').trim().toLowerCase())?.master_name;if(!review.purchase_ledger){const candidate=masters.find(x=>x.kind==='ledger'&&/^purchase(s)?$/i.test(x.name));if(candidate)formVal('purchase_ledger',candidate.name)}const supplierAlias=alias(review.supplier_name,'supplier');if(supplierAlias&&!review.supplier_ledger){formVal('supplier_ledger',supplierAlias);snack(`Previous confirmed supplier match: ${supplierAlias}; review before saving`)}if(result.supplier_suggestions?.length&&!(masters.some(x=>x.kind==='ledger'&&x.name===review.supplier_name)))snack(`Possible supplier: ${result.supplier_suggestions[0]} (optional, confirm later)`);}catch(err){snack(err.message)}}
function renderExtraction(d){
 const meta=d.extraction||{state:d.raw_text?.trim()?'partial':'failed',characters:d.raw_text?.trim()?.length||0,fields:0};
 const title=$('ocrStatusTitle'),details=$('ocrStatusText'),panel=$('ocrPanel');
 const errors=d.review?.notes?.filter(n=>/OCR error|Parser error|unavailable/i.test(n))||[];
 panel.className='ocr-panel '+meta.state;
 title.textContent=meta.state==='failed'?'OCR needs attention':meta.state==='partial'?'OCR partially recognized this invoice':'OCR text was recognized';
 details.textContent=meta.state==='failed'?('No usable invoice fields were extracted. '+(meta.error||errors.at(-1)||'Try a clear upright photo, or enter fields manually.')):`${meta.characters} text characters; ${meta.fields}/4 main fields suggested. Verify all details. No Tally masters required for extraction review.`;
 $('ocrRetryBtn').disabled=d.status==='exported';
}
$('ocrRetryBtn').onclick=async()=>{
 if(!selectedDocId)return;
 const btn=$('ocrRetryBtn');btn.disabled=true;$('ocrStatusText').textContent='Enhancing image and running OCR again. This may take a minute on a phone…';
 try{await api('/api/docs/'+selectedDocId+'/reextract',{method:'POST'});await refresh();await openDoc(selectedDocId);snack('OCR retried. Review extracted values before saving or approving.');}
 catch(err){msg('OCR retry failed: '+err.message,'bad');$('ocrStatusText').textContent=err.message;}
 finally{btn.disabled=false;}
};
function updateStatus(doc){
 dirty=false;
 const d=typeof doc==='string'?{status:doc}:doc;
 const p=$('statusPill');p.className='status-chip '+(d.extraction_verified&&d.status==='draft'?'extraction-ok':d.status);
 p.textContent=d.status==='exported'?'XML exported · Tally not confirmed':d.status==='approved'?'✓ Approved for XML':d.extraction_verified?'✓ Extraction verified':'Draft · OCR review pending';
 $('exportBtn').disabled=d.status!=='approved';$('approveBtn').disabled=d.status==='exported';$('verifyBtn').disabled=d.status==='exported';$('saveBtn').disabled=d.status==='exported';
 [...$('reviewForm').querySelectorAll('input,select,button')].forEach(el=>el.disabled=d.status==='exported');
 $('validateBtn').disabled=d.status==='exported';$('tallyValidateBtn').disabled=d.status==='exported';
}
let previewUrl=null;async function renderPreview(d){const el=$('originalContainer');if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}const file=await sourceBlob(d.id);if(!file){el.textContent='Original source file missing on this device.';return}if(['.png','.jpg','.jpeg','.webp','.pdf'].includes(d.suffix)){previewUrl=URL.createObjectURL(file);const src=previewUrl;if(d.suffix==='.pdf')el.innerHTML=`<iframe title="Original PDF" src="${src}#toolbar=1"></iframe>`;else el.innerHTML=`<img src="${src}" alt="Original supplier invoice">`;}else el.innerHTML='<div class="file-note">Spreadsheet values appear in extracted text below. Compare formulas against the original file separately.</div>';}
function addLine(line={}){
 const i=$('lineItems').children.length+1;
 const div=document.createElement('div');div.className='line-row';
 const field=(label,key,{type='text',span='',placeholder=''}={})=>`<label class="${span}">${label}<input data-field="${key}" type="${type}" ${type==='number'?'step="any"':''} placeholder="${placeholder}" value="${htmlEsc(line[key]??'')}"></label>`;
 div.innerHTML=`<div class="line-top"><strong>Item ${i}</strong><button type="button" class="remove-line">Remove</button></div>
 <div class="line-fields">
 ${field('Printed item description','description',{span:'span4',placeholder:'As printed on invoice'})}
 ${field('HSN/SAC','hsn',{placeholder:'Optional'})}
 ${field('Quantity','qty',{type:'number'})}
 ${field('Invoice unit','unit',{placeholder:'PCS / KG'})}
 ${field('Unit rate (₹)','rate',{type:'number'})}
 ${field('Printed line amount (₹)','source_amount',{type:'number',span:'span2',placeholder:'As on invoice'})}
 ${field('Printed GST rate %','gst_rate',{type:'number',placeholder:'Leave blank if unclear'})}
 ${field('Discount amount (₹)','discount',{type:'number',placeholder:'0'})}
 </div>
 <details class="item-mapping"><summary>Optional: link this item to a Tally stock item</summary>
 <label>Mapping status<select data-field="item_mapping_status"><option value="pending">Unlinked / decide later</option><option value="existing">Existing Tally item with a different name</option><option value="new">New item not yet created in Tally</option></select></label>
 <label>Tally item name<input data-field="stock_item" list="stockChoices" placeholder="Search or enter existing Tally item" value="${htmlEsc(line.stock_item??'')}"></label>
 </details>`;
 div.querySelector('[data-field="item_mapping_status"]').value=line.item_mapping_status||'pending';
 if(line.stock_item)div.querySelector('.item-mapping').open=true;
 div.querySelector('.remove-line').onclick=()=>{div.remove();relabel()};
 div.querySelector('[data-field="stock_item"]').onchange=e=>{const item=masters.find(x=>x.kind==='stock'&&x.name.toLowerCase()===e.target.value.toLowerCase());if(item){div.querySelector('[data-field="item_mapping_status"]').value='existing';if(!div.querySelector('[data-field="unit"]').value)div.querySelector('[data-field="unit"]').value=item.unit;}};
 $('lineItems').appendChild(div);
}
function relabel(){[...$('lineItems').children].forEach((x,i)=>x.querySelector('.line-top strong').textContent='Item '+(i+1))}
function renderLines(lines){$('lineItems').innerHTML='';(lines||[]).forEach(addLine);if(!lines?.length)addLine()}
$('addLineBtn').onclick=()=>addLine();
function reviewPayload(){const frm=$('reviewForm');const fields=['supplier_name','supplier_ledger','supplier_match_status','supplier_gstin','invoice_number','invoice_date','invoice_total','source_taxable','source_cgst','source_sgst','source_igst','purchase_ledger','tax_cgst_ledger','tax_sgst_ledger','tax_igst_ledger','freight_ledger','round_ledger','gst_mode','freight','round_off'];const out={};fields.forEach(k=>out[k]=frm.elements.namedItem(k)?.value||'');out.lines=[...$('lineItems').children].map(row=>Object.fromEntries([...row.querySelectorAll('[data-field]')].map(i=>[i.dataset.field,i.value.trim()]))).filter(x=>['description','qty','rate','source_amount','hsn'].some(key=>x[key]));out.notes=currentDoc?.document.review.notes||[];out.detected_gstins=currentDoc?.document.review.detected_gstins||[];return out}
async function save(){
 if(!selectedDocId)return;
 const data=reviewPayload(),json=JSON.stringify(data);
 if(json===lastSavedReviewJson)return data;
 await api('/api/docs/'+selectedDocId+'/review',{method:'POST',body:json});
 currentDoc.document.review=data;currentDoc.document.status='draft';currentDoc.document.extraction_verified=null;
 lastSavedReviewJson=json;updateStatus(currentDoc.document);return data;
}
$('saveBtn').onclick=async()=>{try{await save();msg('Draft saved. Tally masters are not required for editing.','ok');await refresh()}catch(err){msg(err.message,'bad')}};
async function checkExtraction(){
 await save();const v=await api('/api/docs/'+selectedDocId+'/validate-extraction',{method:'POST'});
 const source=reviewPayload().invoice_total;
 $('totalsBox').innerHTML=`<strong>Printed invoice grand total</strong><span>${source?'₹'+htmlEsc(source):'Not found'}</span>`;
 const errors=v.errors||[],warnings=v.warnings||[];
 msg((v.valid?'Extraction check completed. Compare every field with the original invoice.':'Fields to correct:\n• '+errors.join('\n• '))+(warnings.length?'\n\nPlease review:\n• '+warnings.join('\n• '):'') ,v.valid&&!warnings.length?'ok':v.valid?'':'bad');
 return v;
}
$('validateBtn').onclick=async()=>{try{await checkExtraction();await refresh()}catch(err){msg(err.message,'bad')}};
$('verifyBtn').onclick=async()=>{
 try{const x=await checkExtraction();if(!x.valid)return;
  if(!confirm('Have you compared supplier, invoice number/date, EACH printed item amount, GST and grand total with the original? This only verifies extraction; it does NOT approve Tally posting.'))return;
  await api('/api/docs/'+selectedDocId+'/verify-extraction',{method:'POST'});currentDoc.document.extraction_verified=Date.now();
  updateStatus(currentDoc.document);msg('Extraction verified on this device. Tally matching can be completed later.','ok');await refresh();
 }catch(err){msg(err.message,'bad')}
};
async function checkTally(){await save();const v=await api('/api/docs/'+selectedDocId+'/validate',{method:'POST'});msg(v.valid?'Tally validation passed. This is not proof of successful import.':'Tally mapping still required (does not affect extraction review):\n• '+v.errors.join('\n• '),v.valid?'ok':'bad');return v;}
$('tallyValidateBtn').onclick=async()=>{try{await checkTally()}catch(err){msg(err.message,'bad')}};
$('approveBtn').onclick=async()=>{try{const v=await checkTally();if(!v.valid)return;const confirmApproval=confirm('You are approving a voucher for XML export. Verify exact Tally masters and original invoice first. Continue?');if(!confirmApproval)return;await api('/api/docs/'+selectedDocId+'/approve',{method:'POST'});currentDoc.document.status='approved';updateStatus(currentDoc.document);msg('Approved for XML export. Import only into a test COPY of the Tally company.','ok');await refresh()}catch(err){msg(err.message,'bad')}};
$('exportBtn').onclick=async()=>{try{const r=await api('/api/docs/'+selectedDocId+'/xml');const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='Purchase_'+(currentDoc?.document?.review.invoice_number||'invoice').replace(/[^a-z0-9_-]/gi,'_')+'.xml';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);currentDoc.document.status='exported';updateStatus(currentDoc.document);msg('XML downloaded. Import into a test Tally company and check the Tally import report before production use.','ok');await refresh()}catch(err){msg(err.message,'bad')}};
$('demoBtn').onclick=async()=>{try{const d=await installDemo(company);snack('Demo masters and sample invoice loaded');await refresh();await openDoc(d.id);}catch(err){snack('Demo error: '+err.message)}};
$('backupBtn').onclick=async()=>{try{const blob=await downloadBackup();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='InvoiceBridge_backup_without_sources.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);snack('Metadata backup downloaded. Original files are NOT included.')}catch(err){snack(err.message)}};
$('ocrLanguage').value=localStorage.getItem('ib_ocr_language')||'eng';
$('ocrLanguage').onchange=e=>{localStorage.setItem('ib_ocr_language',e.target.value);snack('OCR preference saved for this device')};
if('serviceWorker'in navigator&&location.protocol==='https:'){navigator.serviceWorker.register('./sw.js').catch(()=>{});}
init();

$('reviewForm').addEventListener('input',()=>{if(currentDoc&&currentDoc.document.status==='approved'){dirty=true;$('exportBtn').disabled=true;msg('You made changes to an approved invoice. Save them and approve again before exporting.','bad')}else if(currentDoc?.document?.extraction_verified){$('statusPill').textContent='Edits pending · Save and verify again';$('statusPill').className='status-chip draft';}});
