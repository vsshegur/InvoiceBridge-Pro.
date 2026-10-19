/** Conservative OCR-to-review hints. No automatic Tally master acceptance or approval.
 * Only populate invoice rows when the numbers independently reconcile.
 */
const trim=v=>String(v??'').trim();
const MONTHS={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};
const DATE_TEXT=String.raw`(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[\s./-]+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[\s.,/-]+\d{2,4})`;
const dateRE=new RegExp(DATE_TEXT,'i');
function normalizedDate(value,parseDate){
  const s=trim(value);const native=parseDate(s);if(native)return native;
  const m=s.match(/^(\d{1,2})[\s./-]+([a-z]{3,9})[\s.,/-]+(\d{2,4})$/i);
  if(!m)return '';
  const month=MONTHS[m[2].slice(0,4).toLowerCase()]||MONTHS[m[2].slice(0,3).toLowerCase()];
  const year=m[3].length===2?Number(m[3])>=80?'19'+m[3]:'20'+m[3]:m[3];
  if(!month)return '';
  return parseDate(`${year}-${String(month).padStart(2,'0')}-${String(Number(m[1])).padStart(2,'0')}`);
}
function labelledValue(lines,labelRegex){
  for(let i=0;i<Math.min(lines.length,90);i++){
    const m=lines[i].match(labelRegex);
    if(!m)continue;
    const after=trim(lines[i].slice(m.index+m[0].length)).replace(/^[\s:#|–-]+/,'');
    if(after)return {text:after,index:i};
    if(i+1<lines.length)return {text:trim(lines[i+1]),index:i+1};
  }
  return {text:'',index:-1};
}
const badBusiness=/^(?:TAX\s*INVOICE|INVOICE|ORIGINAL|DUPLICATE|CREDIT|PLOT\b|SHOP\b|GST(?:IN)?\b|DATE\b|DATED\b|PARTY\b|BUYER\b|BILL\b|DELIVERY\b|SUPPLY\b|MOBILE\b|PHONE\b|MAHARASHTRA\b|SOLAPUR\b|STATE\b|DESCRIPTION\b|MODE\b|CONTACT\b|PIN\b|PAGE\b|TRANSPORT\b|TERMS\b|RATE\b|AMOUNT\b|QTY\b)/i;
function findSupplier(lines){
  // Trust explicit labels when present. Tally invoices usually print a standalone supplier name.
  const label=labelledValue(lines,/\b(?:supplier|sold\s*by|vendor|seller)\s*[:\-]/i).text;
  if(label&&/[a-z]/i.test(label))return trim(label).slice(0,85);
  const buyerAt=lines.findIndex(l=>/\b(?:buyer\s*\(?bill\s*to\)?|bill\s*to|consignee)\b/i.test(l));
  const header=lines.slice(0,Math.min(buyerAt>=0?buyerAt:12,14));
  const candidates=header.map(x=>trim(x).replace(/^[^A-Za-z]+/,'').replace(/[\s:|]+$/,'')).filter(x=>
    x.length>=8&&x.length<=75&&/[A-Za-z]/.test(x)&&!badBusiness.test(x)&&!/^\d/.test(x)&&
    !/\b(?:road|plot\s*no|phone|mob|gstin|state\s*code|email|www\.|original|recipient)\b/i.test(x)&&
    x.split(/\s+/).length>=2&&x.replace(/[^A-Za-z]/g,'').length>=8&&
    (x===x.toUpperCase()||/\b(?:Textile|Industries|Traders|Enterprise|Yarn|Mill|Cotton|Company|Fabrics)\b/i.test(x))
  );
  return candidates[0]||'';
}
function findInvoiceNumber(lines){
  const label=/\b(?:tax\s*)?(?:invoice|inv\.?|bill)\s*(?:number|no\.?|#)\s*[:#-]?/i;
  for(let i=0;i<Math.min(lines.length,50);i++){
    const m=lines[i].match(label);if(!m)continue;
    let tail=trim(lines[i].slice(m.index+m[0].length)).replace(/^[\s:#|–-]+/,'');
    // Two-column Tally header: "Invoice No.     Dated" / "220   15-Jun-26".
    if(/^dated?\b/i.test(tail)||!tail)tail=trim(lines[i+1]||'');
    const n=tail.match(/^([A-Z0-9][A-Z0-9/_-]{0,30})(?=\s|$|\|)/i);
    if(n&&!/^(?:dated?|delivery|buyer|invoice|gstin|original|tax)$/i.test(n[1]))return n[1];
  }
  return '';
}
function findInvoiceDate(lines,parseDate){
  const re=new RegExp(DATE_TEXT,'i');
  for(let i=0;i<Math.min(lines.length,60);i++){
    const s=lines[i];const marker=s.match(/\b(?:invoice\s*date|dated|date)\b/i);
    if(!marker||/delivery\s*date|dispatch\s*date/i.test(s))continue;
    const after=s.slice(marker.index+marker[0].length);
    for(const v of [after,lines[i+1]||'',lines[i+2]||'']){const found=v.match(re);if(found){const d=normalizedDate(found[0],parseDate);if(d)return d;}}
  }
  // Some invoices print a bare date in a second-column heading.
  for(const s of lines.slice(0,24)){const found=s.match(re);if(found){const d=normalizedDate(found[0],parseDate);if(d)return d;}}
  return '';
}
function findTotal(lines){
  // Do not confuse amounts on item rows or GST subtotal with the grand total.
  const p=/\b(?:grand\s*total|invoice\s*total|net\s*(?:total|amount)|amount\s*payable|total\s*amount|total\s*invoice\s*value)\b/i;
  for(let i=lines.length-1;i>=0;i--){const m=lines[i].match(p);if(!m)continue;
    const tail=trim(lines[i].slice(m.index+m[0].length));
    let matches=[...tail.matchAll(/(?:₹|Rs\.?\s*)?([\d,]+\.\d{2}|[\d,]{3,})(?![\d.])/gi)].map(x=>x[1]);
    if(!matches.length&&i+1<lines.length)matches=[...lines[i+1].matchAll(/(?:₹|Rs\.?\s*)?([\d,]+\.\d{2}|[\d,]{3,})(?![\d.])/gi)].map(x=>x[1]);
    const num=matches.at(-1)?.replace(/,/g,'');if(num&&Number(num)>0)return num;
  }
  // Some Tally print layouts use only a terminal 'Total' label.
  for(let i=lines.length-1;i>=Math.floor(lines.length/2);i--){
    const m=lines[i].match(/^total\s*[:=\-]?\s*(?:₹|Rs\.?\s*)?([\d,]+(?:\.\d{2})?)\s*$/i);
    if(m&&Number(m[1].replace(/,/g,''))>0)return m[1].replace(/,/g,'');
  }
  return '';
}
function detectedItems(lines){
 const items=[];let rejected=0;
 // Common printed bill rows: <description> <HSN> <qty> <unit> <rate> [per] <amount>.
 const row=/^\s*(?:\d+[.)]\s*)?(.{5,80}?)\s+(?:\d{4,8}\s+)?([\d,]+(?:\.\d{1,3})?)\s+(PCS|NOS|NO|KG|KGS|MTR|MTS|METER|METRE|DOZ|BOX|SET|BAG)\s+([\d,]+(?:\.\d{1,4})?)\s+(?:(?:PCS|NOS|NO|KG|KGS|MTR|MTS|METER|METRE)\s+)?([\d,]+\.\d{2})\s*$/i;
 for(const line of lines){const m=line.match(row);if(!m)continue;
   const qty=Number(m[2].replace(/,/g,'')),rate=Number(m[4].replace(/,/g,'')),gross=Number(m[5].replace(/,/g,''));
   if(!Number.isFinite(qty)||!Number.isFinite(rate)||!Number.isFinite(gross)||qty<=0||rate<=0||gross<=0)continue;
   if(Math.abs(qty*rate-gross)>Math.max(0.03,gross*0.00002)){rejected++;continue;}
   items.push({description:trim(m[1]),stock_item:'',qty:String(qty),unit:m[3].toUpperCase(),rate:String(rate),gst_rate:'0',discount:'0'});
   if(items.length>=80)break;
 }
 return {items,rejected};
}
export function parseInvoiceText(raw,notes,{emptyReview,parseDate}){
 const text=String(raw??'').slice(0,150000);
 const lines=text.replace(/\r/g,'').split('\n').map(s=>s.replace(/[\t ]+/g,' ').trim()).filter(Boolean);
 const result=emptyReview();
 result.supplier_name=findSupplier(lines);
 result.invoice_number=findInvoiceNumber(lines);
 result.invoice_date=findInvoiceDate(lines,parseDate);
 result.invoice_total=findTotal(lines);
 const gst=[...text.matchAll(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/gi)].map(x=>x[0].toUpperCase());
 result.detected_gstins=[...new Set(gst)].slice(0,10);
 // Supplier GSTIN is suggested only when a GSTIN label appears before the 'Buyer / Bill to' section.
 const buyerAt=lines.findIndex(l=>/\b(?:buyer\s*\(?bill\s*to\)?|bill\s*to|consignee)\b/i.test(l));
 for(const line of lines.slice(0,buyerAt>=0?buyerAt:Math.min(lines.length,15))){
   if(!/GSTIN/i.test(line))continue;
   const m=line.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/i);
   if(m){result.supplier_gstin=m[0].toUpperCase();break;}
 }
 const extracted=detectedItems(lines);result.lines=extracted.items;
 result.notes=[...notes,`OCR extracted ${text.trim().length} text characters and suggested ${[result.supplier_name,result.invoice_number,result.invoice_date,result.invoice_total].filter(Boolean).length}/4 invoice fields.`,
  ...(extracted.rejected?[`${extracted.rejected} ambiguous item row(s) were not prefilled because quantity × rate did not match the printed amount.`]:[]),
  'Suggested OCR values must be compared against the source. All Tally stock items, ledgers, GST rates and totals require explicit verification.'];
 return result;
}
