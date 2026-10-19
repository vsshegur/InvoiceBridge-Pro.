import {parseInvoiceText} from './invoice-parser.mjs';
/** InvoiceBridge Pro - pure, deterministic accounting and mapping helpers.
 * Never marks unverified OCR, fuzzy matches or Tally XML as posted.
 */
export const COMPANIES = {vipul:'VIPUL TEXTILES',vijayalaxmi:'VIJAYALAXMI TEXTILES'};
export const MAX_FILE_BYTES = 15*1024*1024;
export const MAX_PAGES = 12;
const upper=s=>String(s??'').trim().toUpperCase();
const low=s=>String(s??'').trim().toLocaleLowerCase('en');
export const escapeXML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export const clean=v=>String(v??'').trim();
export function fixed(x,places=2,{allowNegative=false}={}) { // returns BigInt in the requested fixed-point scale
  const s=String(x??'').trim().replace(/[,₹\s]/g,'');
  if(!/^-?\d+(?:\.\d+)?$/.test(s))throw Error(`Invalid number: ${String(x).slice(0,24)||'(empty)'}`);
  if(s.startsWith('-')&&!allowNegative)throw Error('Negative amount not allowed');
  const negative=s.startsWith('-'),str=negative?s.slice(1):s;
  const [int,frac='']=str.split('.');
  if(int.length>11||frac.length>places)throw Error('Number exceeds supported precision or range');
  const result=BigInt(int)*10n**BigInt(places)+BigInt((frac+'0'.repeat(places)).slice(0,places)||'0');
  return negative?-result:result;
}
export function money(x){return fixed(x,2,{allowNegative:true})}
export function formatPaise(cents){let n=BigInt(cents);const neg=n<0n?'−':'';if(n<0n)n=-n;return `${neg}${n/100n}.${String(n%100n).padStart(2,'0')}`;}
export function roundHalfUp(num,den){if(den<=0n)throw Error('Invalid denominator');const neg=num<0n;if(neg)num=-num;const v=(num+den/2n)/den;return neg?-v:v;}
export function calculate(v){
 const sums={taxable:0n,cgst:0n,sgst:0n,igst:0n,grand:0n};const rows=[];
 if(!['intra','inter'].includes(v.gst_mode||'intra'))throw Error('Select intra-state or inter-state GST');
 (v.lines||[]).forEach((line,i)=>{
  const qty=fixed(line.qty,4),rate=fixed(line.rate,4),disc=fixed(line.discount??'0',2),gst=fixed(line.gst_rate??'0',2);
  if(qty<=0n||gst>10000n)throw Error(`Item ${i+1}: quantity or GST outside supported range`);
  const taxable=roundHalfUp(qty*rate,1000000n)-disc;
  if(taxable<0n)throw Error(`Item ${i+1}: discount exceeds gross`);
  const cgst=(v.gst_mode||'intra')==='intra'?roundHalfUp(taxable*gst,20000n):0n;
  const sgst=cgst;
  const igst=(v.gst_mode||'intra')==='inter'?roundHalfUp(taxable*gst,10000n):0n;
  sums.taxable+=taxable;sums.cgst+=cgst;sums.sgst+=sgst;sums.igst+=igst;
  rows.push({taxable,cgst,sgst,igst});
 });
 const freight=money(v.freight||'0');const rounding=money(v.round_off||'0');
 if(freight<0n)throw Error('Negative freight is not supported in this edition');
 sums.grand=sums.taxable+sums.cgst+sums.sgst+sums.igst+freight+rounding;
 return {totals:sums,rows};
}
export function parseDate(value){const s=clean(value);let y,m,d;
 let z=s.match(/^(\d{4})-(\d\d)-(\d\d)$/);if(z){[,y,m,d]=z}
 else{z=s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);if(!z)return '';d=z[1];m=z[2];y=z[3];if(y.length===2)y='20'+y;}
 y=Number(y);m=Number(m);d=Number(d);const date=new Date(Date.UTC(y,m-1,d));if(date.getUTCFullYear()!==y||date.getUTCMonth()+1!==m||date.getUTCDate()!==d||y<2000||y>2100)return '';
 return [y,String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-');
}
export function parseMasters(xml){if(typeof xml!=='string'||xml.length>20*1024*1024)throw Error('Tally master XML must be under 20 MB');
 if(typeof DOMParser==='undefined')throw Error('XML parser not available');
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('DTD and entities are not allowed in masters');
 const dom=new DOMParser().parseFromString(xml,'application/xml');if(dom.querySelector('parsererror'))throw Error('Invalid XML file');
 const result=[]; for(const el of dom.getElementsByTagName('*')){const kind=el.tagName.split(':').pop().toUpperCase();if(!['LEDGER','STOCKITEM','GROUP'].includes(kind))continue;
 const get=(tag)=>{for(const child of el.children){if(child.tagName.split(':').pop().toUpperCase()===tag)return clean(child.textContent)}return ''};
 const name=clean(el.getAttribute('NAME')||get('NAME'));if(!name)continue;
 const gstNodes=Array.from(el.getElementsByTagName('*')).filter(c=>['GSTIN','PARTYGSTIN'].includes(c.tagName.split(':').pop().toUpperCase()));
 result.push({kind:kind==='STOCKITEM'?'stock':kind.toLowerCase(),name,parent:get('PARENT'),unit:get('BASEUNITS'),gstin:upper(gstNodes.find(x=>clean(x.textContent))?.textContent||'')});}
 const unique=new Map(result.map(x=>[x.kind+'|'+low(x.name),x]));if(!unique.size)throw Error('No Tally ledgers, groups or stock items found');return [...unique.values()];}
export function isCreditor(row,masters){const parents=new Map(masters.filter(x=>x.kind==='group').map(x=>[low(x.name),low(x.parent)]));let node=low(row.parent);const seen=new Set();while(node&&!seen.has(node)){if(node==='sundry creditors')return true;seen.add(node);node=parents.get(node)||''}return false;}
export function emptyReview(){return {supplier_name:'',supplier_ledger:'',supplier_gstin:'',invoice_number:'',invoice_date:'',invoice_total:'',purchase_ledger:'',tax_cgst_ledger:'',tax_sgst_ledger:'',tax_igst_ledger:'',freight_ledger:'',round_ledger:'',gst_mode:'intra',freight:'0',round_off:'0',lines:[],notes:[],detected_gstins:[]}}
export function extractGuess(raw,notes=[]){return parseInvoiceText(raw,notes,{emptyReview,parseDate});}
export function simpleCSVRows(text){const rows=text.replace(/^\uFEFF/,'').split(/\r?\n/).slice(0,800).map(line=>line.split(',').map(v=>v.replace(/^"|"$/g,'').trim()));
 // This limited parser handles simple spreadsheets only; mixed CSV quoting must be manually reviewed.
 let headerIndex=rows.findIndex(r=>r.some(v=>/^(item|product|description|item name)$/i.test(v))&&r.some(v=>/^qty|quantity$/i.test(v))&&r.some(v=>/^rate|price$/i.test(v)));
 if(headerIndex<0)return [];
 const h=rows[headerIndex].map(x=>x.toLowerCase());let ix=h.findIndex(x=>/^(item|product|description|item name)$/.test(x)),q=h.findIndex(x=>/^qty|quantity$/.test(x)),r=h.findIndex(x=>/^rate|price$/.test(x));
 const g=h.findIndex(x=>/^gst|gst%|tax rate$/.test(x));const unit=h.findIndex(x=>/^unit|uom$/.test(x));const items=[];
 for(const row of rows.slice(headerIndex+1)){const description=clean(row[ix]);if(!description||/total/i.test(description))break;if(!row[q]||!row[r])continue;
 items.push({description,stock_item:'',qty:row[q],unit:unit<0?'':row[unit],rate:row[r],gst_rate:g<0?'5':row[g],discount:'0'});if(items.length>=120)break;}
 return items;}
export function checkReview(v,masters=[],otherDocs=[],currentDocId=''){
 const errors=[];
 if(!clean(v.supplier_name))errors.push('Supplier name from invoice is required');
 if(!clean(v.invoice_number))errors.push('Invoice number is required');
 if(!parseDate(v.invoice_date))errors.push('A valid invoice date is required');
 if(!clean(v.invoice_total))errors.push('Source invoice grand total is required');
 if(!v.lines?.length)errors.push('At least one item is required');
 const ledger=new Map(masters.filter(x=>x.kind==='ledger').map(x=>[low(x.name),x]));const stock=new Map(masters.filter(x=>x.kind==='stock').map(x=>[low(x.name),x]));
 const supplier=ledger.get(low(v.supplier_ledger));
 if(!supplier)errors.push('Choose an exact supplier ledger from imported Tally masters');
 else {if(!isCreditor(supplier,masters))errors.push('Supplier ledger is not in the Sundry Creditors group');if(clean(v.supplier_gstin)&&supplier.gstin&&upper(v.supplier_gstin)!==upper(supplier.gstin))errors.push('Supplier GSTIN conflicts with the Tally master');}
 let amounts=null;try{amounts=calculate(v);if(money(v.invoice_total)!==amounts.totals.grand&&((money(v.invoice_total)-amounts.totals.grand)>2n||(money(v.invoice_total)-amounts.totals.grand)<-2n))errors.push('Grand total does not reconcile with taxable, GST, freight and round-off');}catch(err){errors.push(err.message)}
 const hasTax=!!v.lines?.some(x=>{try{return fixed(x.gst_rate||'0',2)>0n}catch{return false}});
 for(const [field,label,required] of [['purchase_ledger','Purchase',true],['tax_cgst_ledger','CGST',v.gst_mode==='intra'&&hasTax],['tax_sgst_ledger','SGST',v.gst_mode==='intra'&&hasTax],['tax_igst_ledger','IGST',v.gst_mode==='inter'&&hasTax],['freight_ledger','Freight',safeNonZero(v.freight)],['round_ledger','Round-off',safeNonZero(v.round_off)]]){
  if(required&&!clean(v[field]))errors.push(`${label} ledger is required`);if(clean(v[field])&&!ledger.has(low(v[field])))errors.push(`${label} ledger not in Tally masters`);
 }
 (v.lines||[]).forEach((line,i)=>{const found=stock.get(low(line.stock_item));if(!found)errors.push(`Item ${i+1}: choose an exact Tally stock item`);else if(low(line.unit)!==low(found.unit))errors.push(`Item ${i+1}: unit differs from Tally stock master (${found.unit})`);});
 if(clean(v.supplier_gstin)&&!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/i.test(v.supplier_gstin))errors.push('Supplier GSTIN format is invalid');
 const foundDuplicate=otherDocs.some(d=>d.id!==currentDocId&&low(d.review?.invoice_number)===low(v.invoice_number)&&low(d.review?.supplier_ledger||d.review?.supplier_name)===low(v.supplier_ledger||v.supplier_name));if(foundDuplicate)errors.push('Duplicate supplier invoice number in this company');
 return {valid:errors.length===0,errors:[...new Set(errors)],calculation:amounts};}
function safeNonZero(v){try{return money(v||'0')!==0n}catch{return true}}
export function purchaseXML(v,companyName){const {totals,rows}=calculate(v);if(!clean(v.invoice_total)||((totals.grand-money(v.invoice_total)>2n)||(totals.grand-money(v.invoice_total)<-2n)))throw Error('Invoice totals not reconciled');
 const tag=(k,s)=>`<${k}>${escapeXML(s)}</${k}>`;let body='';const ledgerEntry=(ledger,amt,{party=false}={})=>`<ALLLEDGERENTRIES.LIST>${tag('LEDGERNAME',ledger)}${tag('ISDEEMEDPOSITIVE',amt<0n?'Yes':'No')}${party?tag('ISPARTYLEDGER','Yes'):''}${tag('AMOUNT',formatPaise(amt).replace('−','-'))}${party?`<BILLALLOCATIONS.LIST>${tag('NAME',v.invoice_number)}${tag('BILLTYPE','New Ref')}${tag('AMOUNT',formatPaise(amt).replace('−','-'))}</BILLALLOCATIONS.LIST>`:''}</ALLLEDGERENTRIES.LIST>`;
 body+=ledgerEntry(v.supplier_ledger,totals.grand,{party:true});
 for(let i=0;i<v.lines.length;i++){const line=v.lines[i],calc=rows[i],qty=fixed(line.qty,4),rate=roundHalfUp(calc.taxable*1000000n,qty);const effective=Number(rate)/10000;const qtyText=Number(qty)/10000;
 body+=`<ALLINVENTORYENTRIES.LIST>${tag('STOCKITEMNAME',line.stock_item)}${tag('ISDEEMEDPOSITIVE','Yes')}${tag('RATE',`${effective.toFixed(4)}/${line.unit}`)}${tag('ACTUALQTY',`${qtyText} ${line.unit}`)}${tag('BILLEDQTY',`${qtyText} ${line.unit}`)}${tag('AMOUNT',formatPaise(-calc.taxable).replace('−','-'))}<ACCOUNTINGALLOCATIONS.LIST>${tag('LEDGERNAME',v.purchase_ledger)}${tag('ISDEEMEDPOSITIVE','Yes')}${tag('AMOUNT',formatPaise(-calc.taxable).replace('−','-'))}</ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>`;
 }
 for(const [k,f] of [['cgst','tax_cgst_ledger'],['sgst','tax_sgst_ledger'],['igst','tax_igst_ledger']])if(totals[k]!==0n)body+=ledgerEntry(v[f],-totals[k]);
 for(const [amount,field] of [[money(v.freight||'0'),'freight_ledger'],[money(v.round_off||'0'),'round_ledger']])if(amount!==0n)body+=ledgerEntry(v[field],-amount);
 const result=`<?xml version="1.0" encoding="UTF-8"?><ENVELOPE><HEADER>${tag('TALLYREQUEST','Import Data')}</HEADER><BODY><IMPORTDATA><REQUESTDESC>${tag('REPORTNAME','Vouchers')}<STATICVARIABLES>${tag('SVCURRENTCOMPANY',companyName)}</STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE><VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Invoice Voucher View">${tag('DATE',parseDate(v.invoice_date).replaceAll('-',''))}${tag('VOUCHERTYPENAME','Purchase')}${tag('REFERENCE',v.invoice_number)}${tag('PARTYLEDGERNAME',v.supplier_ledger)}${tag('PERSISTEDVIEW','Invoice Voucher View')}${tag('ISINVOICE','Yes')}${tag('NARRATION',`Verified by human in InvoiceBridge; supplier ref: ${v.invoice_number}`)}${body}</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
 return result;
}
