/**
 * Invoice OCR-to-review parser. Every value is an unverified suggestion.
 * Printed totals take precedence over recomputing values from a rounded rate.
 * Parsing is intentionally not a gate on preserving the original OCR text.
 */
const trim = v => String(v ?? '').trim();
const MONTHS = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};
const DATE_TEXT = String.raw`(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[\s./-]+[A-Za-z]{3,9}[\s.,/-]+\d{2,4})`;
const dateRE = new RegExp(DATE_TEXT, 'gi');
const moneyRE = /(?:₹\s*|(?:Rs\.?|INR)\s*)?([0-9][\d,]*\.\d{2})(?!\d)/g;
const number = x => Number(String(x).replace(/,/g, ''));
const fmt = x => Number.isFinite(x) ? x.toFixed(2) : '';
const getAmounts = line => [...String(line).matchAll(moneyRE)].map(m => ({raw:m[1].replace(/,/g,''), num:number(m[1]), index:m.index}));
const firstMoney = line => getAmounts(line).find(x=>x.num>0)?.raw||'';
function normalizedDate(value, parseDate) {
 const s=trim(value); const direct=parseDate(s);if(direct)return direct;
 const m=s.match(/^(\d{1,2})[\s./-]+([A-Za-z]{3,9})[\s.,/-]+(\d{2,4})$/);
 if(!m)return '';
 let mon=m[2].toLowerCase();
 // Frequent OCR slips in a printed Tally date; strictly bounded to the month token.
 if(/^(sop|s6p|s3p)$/.test(mon))mon='sep';
 if(mon==='jun.'||mon==='jUn')mon='jun';
 const month=MONTHS[mon]||MONTHS[mon.slice(0,4)]||MONTHS[mon.slice(0,3)];
 if(!month)return '';
 const y=m[3].length===2?(Number(m[3])>=80?'19':'20')+m[3]:m[3];
 return parseDate(`${y}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`);
}
function findSupplier(lines){
 const label=lines.find(l=>/\b(?:supplier|sold\s+by|vendor|seller)\s*[:\-]/i.test(l));
 if(label){const m=label.match(/\b(?:supplier|sold\s+by|vendor|seller)\s*[:\-]\s*(.+)$/i);if(m&&m[1].length>3)return trim(m[1]).slice(0,100);}
 const buyer=lines.findIndex(x=>/buyer\s*\(?\s*bill|consignee|bill\s*to/i.test(x));
 const header=lines.slice(0,buyer>=0?buyer:Math.min(lines.length,18));
 for(const raw of header){
  const s=raw.replace(/^[^A-Za-z]+/, '').replace(/[|\s]+$/,'').trim();
  if(s.length<7||s.length>85||!/\b[A-Za-z]{3}/.test(s))continue;
  if(/^(?:tax\s*invoice|invoice\s*(?:no|number)|dated|date|duplicate|original|buyer|bill|delivery|reference|state|gstin|contact|phone|plot|road|description|amount|mode|terms|transport)/i.test(s))continue;
  if(/(?:\bGSTIN|\bPIN|\bROAD|\bPLOT|\bNAGAR|\bSOLAPUR\b|\bMAHARASHTRA\b|\bCODE\b|\d{6}\b|DUPLICATE|ORIGINAL|TRANSPORTER)/i.test(s))continue;
  if(!/(?:[A-Z]{4,}\s+[A-Z]{3,})|\b(?:textile|industries|traders|enterprise|yarn|mill|cotton|fabrics)\b/i.test(s))continue;
  const candidate=s.split(/\s{3,}|\s*\|\s*/)[0].trim().replace(/\s+[a-z]{2,}\b.*$/, '').replace(/\s+\d{1,2}[-/]\w{3}[-/]\d{2,4}.*$/, '').trim();
  if(candidate.length>=7)return candidate;
 }
 return '';
}
const invMarker=/(?:\b(?:invoice|invo[i1l][cse]{1,3}|t?invoi[cse]{1,3}|inv\.?|bill)\s*(?:no\.?|number|#)\b)/i;
function findInvoiceNumber(lines){
 const top=lines.slice(0,Math.min(lines.length,65));
 for(let i=0;i<top.length;i++){
  const label=top[i].match(invMarker);if(!label)continue;
  const tail=trim(top[i].slice(label.index+label[0].length));
  const candidates=[tail,...top.slice(i+1,Math.min(i+4,top.length))];
  for(const s of candidates){
   // A label beside the Dated column may have its value on the next OCR line.
   if(/^\s*(?:dated|date|delivery|reference|mode|buyer|tax invoice)\b/i.test(s))continue;
   let m=s.match(/^\s*[^\w\d]*([A-Z0-9][A-Z0-9/_-]{0,24})\b/i);
   if(!m)continue;
   const id=m[1];if(/^(?:no|dated?|delivery|buyer|reference|invoice|tax|mode|gstin|terms)$/i.test(id))continue;
   if(/^\d{1,2}[-/]\w{3}/.test(id)||id.length>22)continue;
   return id;
  }
 }
 return '';
}
function findInvoiceDate(lines,parseDate){
 const attempt=s=>{for(const m of String(s).matchAll(dateRE)){const d=normalizedDate(m[0],parseDate);if(d)return d;}return ''};
 for(let i=0;i<Math.min(lines.length,65);i++){
  const s=lines[i];if(!/\b(?:dated|date|invoice\s+date)\b/i.test(s))continue;
  if(/(?:delivery\s+(?:note\s+)?date|dispatch\s+date|buyer's\s+order\s+no)/i.test(s))continue;
  // Prefer a date in the same or the very next row, before the delivery note.
  for(const line of [s.slice(s.search(/\b(?:dated|date|invoice\s+date)\b/i)),lines[i+1]||'']){
   const d=attempt(line);if(d)return d;
  }
 }
 // The first top-header date can still be used when the OCR destroyed the 'Dated' marker.
 for(const s of lines.slice(0,15)){const d=attempt(s);if(d)return d;}
 return '';
}
function parseAmountWords(lines){
 // Typically "INR Fifty Four Thousand Eight Hundred Eighty Six Only".
 const start=lines.findIndex(s=>/(?:^|[^A-Za-z])INR\s+[a-z]+/i.test(s)&&/\b(?:thousand|hundred|lakh|only)\b/i.test(s));
 if(start<0)return '';
 const chunk=lines.slice(start,Math.min(start+3,lines.length)).join(' ');
 const m=chunk.match(/(?:^|[^A-Za-z])INR\s+([\w\s-]+?)\s+Only\b/i);if(!m)return '';
 const words=m[1].toLowerCase().replace(/[^a-z\s-]/g,' ').split(/[\s-]+/).filter(Boolean);
 const small={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
 let whole=0,group=0,paise=0,inPaise=false,saw=false;
 for(const w of words){
  if(['and','rupees','rupee','paisa','paise','only'].includes(w))continue;
  if(w==='hundred'){group*=100;continue;}
  if(['thousand','lakh','lac','million','crore'].includes(w)){
   const factor={thousand:1000,lakh:100000,lac:100000,million:1000000,crore:10000000}[w];whole+=group*factor;group=0;continue;
  }
  if(w==='point')return '';
  if(w in small){if(inPaise)paise+=small[w];else group+=small[w];saw=true;continue;}
  if(w==='paise')continue;
  return '';
 }
 // Do not mistake "and" in "Hundred and Eighty" for a paise separator.
 const pm=m[1].match(/\band\s+((?:[A-Za-z-]+\s*){1,4})\s+paise\b/i);
 if(pm){let p=0;for(const w of pm[1].toLowerCase().split(/[\s-]+/).filter(Boolean)){if(!(w in small))return '';p+=small[w];}if(p>=100)return '';paise=p;
  // Those paise words were counted as group values above. Remove them.
  group-=p;
 }
 if(!saw||whole+group<1)return '';
 return fmt(whole+group+paise/100);
}
function findTotal(lines){
 const chargeIdx=lines.findIndex(x=>/amount\s*chargeab|chargeable\s*\(?\s*in\s*words/i.test(x));
 const wordsIdx=lines.findIndex(x=>/(?:^|[^A-Za-z])INR\s+(?:fifty|four|five|one|two|three|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|sixty|seventy|eighty|ninety|hundred)/i.test(x));
 const cutoff=chargeIdx>=0?chargeIdx+1:wordsIdx>=0?wordsIdx:lines.length;
 let scanned='';
 // 'Grand Total' can appear well before the HSN tax-summary table.
 for(let i=0;i<cutoff;i++){
  const s=lines[i];if(!/\b(?:grand\s*total|invoice\s*total|net\s*amount|amount\s*payable|total\s*amount|total\s*invoice\s*value|total)\b/i.test(s))continue;
  if(/\btotal\s*tax\s*amount|\btotal\s*taxable/i.test(s))continue;
  for(const segment of [s,lines[i+1]||'',lines[i+2]||'']){
   const amounts=getAmounts(segment).filter(x=>x.num>=1);
   if(amounts.length)scanned=amounts.at(-1).raw;
   if(scanned)break;
  }
 }
 if(!scanned&&chargeIdx>=0){for(let i=chargeIdx;i>=Math.max(0,chargeIdx-4);i--){const a=getAmounts(lines[i]).filter(x=>x.num>=1);if(a.length){scanned=a.at(-1).raw;break;}}}
 const words=parseAmountWords(lines);
 if(scanned&&words&&Math.abs(number(scanned)-number(words))>0.02)return {value:words,warning:`OCR numeric total ₹${scanned} disagrees with the amount in words ₹${words}; proposed amount-in-words total must be checked against the photo.`};
 return {value:scanned||words,warning:!scanned&&words?'Grand total suggested from invoice amount in words; check against printed figures.':''};
}
function normalizeRow(s){return s.replace(/[|\[\]{}]/g,' ').replace(/[)](?=\s)/g,' ').replace(/\bPCS\./ig,'PCS').replace(/\s+/g,' ').trim();}
const UNITS='(?:PCS|NOS|NO|KG|KGS|MTR|MTS|METER|METRE|DOZ|BOX|SET|BAG|LTR|LTRS)';
const itemWithHSN=new RegExp(`^\\s*(?:\\d{1,3}[.)]?\\s+)?(.{3,110}?)\\s+(\\d{4,8})\\s+([\\d,]+(?:\\.\\d{1,3})?)\\s+(${UNITS})\\s+([\\d,]+(?:\\.\\d{1,4})?)(?:\\s+${UNITS})?\\s+(.+)$`,'i');
const itemWithoutHSN=new RegExp(`^\\s*(?:\\d{1,3}[.)]?\\s+)?(.{4,110}?)\\s+([\\d,]+(?:\\.\\d{1,3})?)\\s+(${UNITS})\\s+([\\d,]+(?:\\.\\d{1,4})?)(?:\\s+${UNITS})?\\s+(.+)$`,'i');
function detectedItems(lines){
 const items=[],notes=[];const start=lines.findIndex(s=>/description\s*(?:of\s*)?(?:goods|item)|HSN\/SAC.*Quantity/i.test(s));
 // Scan any row when OCR missed the heading. Reject discounts/tax/summary as items.
 const beginning=start>=0?start+1:0;
 for(let i=beginning;i<lines.length;i++){
  const raw=lines[i];if(start>=0&&i>start+1&&/^(?:Less\b|Sales\s*Discount|[CS]G\s*S\s*T|S\$\s*GST|Round\s*Off|Total\b|Amount\s*Chargeable)/i.test(raw.replace(/^[^\w\d]+/,'')))break;
  const line=normalizeRow(raw.replace(/^\s*[|{]+/,'').replace(/[)\],.\s]+$/g, x=>x.includes('.')?x.replace(/\.$/,''):''));
  if(!line||/\b(?:grand\s*total|tax\s*invoice|total\s*tax|delivery|buyer|amount\s*chargeable|description|state\s*name|invoice\s*no)\b/i.test(line))continue;
  let m=line.match(itemWithHSN),hsn='';if(m){hsn=m[2];m=[m[0],m[1],m[3],m[4],m[5],m[6]];}else m=line.match(itemWithoutHSN);
  if(!m)continue;
  const description=trim(m[1]).replace(/^[1lI]\s+/,'').replace(/^[^A-Za-z0-9]+/,'');
  if(description.length<3||!/[A-Za-z]{2}/.test(description)||/^(?:tax|sales|discount|total|hsn|amount)/i.test(description))continue;
  const qty=number(m[2]),rate=number(m[4]);if(!(qty>0&&rate>=0&&Number.isFinite(qty)&&Number.isFinite(rate)))continue;
  const amountText=m[5]; const amtCandidates=getAmounts(amountText);
  const clear=amtCandidates.filter(a=>!/[§$?@]/.test(amountText.slice(Math.max(0,a.index-2),a.index)));
  const source=clear.at(-1)?.raw||'';
  if(!source)notes.push(`Item "${description}": OCR could not reliably read the printed line amount. Keep it unconfirmed.`);
  else if(Math.abs(qty*rate-number(source))>0.03)notes.push(`Item "${description}": displayed rate × quantity differs from printed amount; both kept for review.`);
  items.push({description,hsn,stock_item:'',item_mapping_status:'pending',qty:String(qty),unit:m[3].toUpperCase(),rate:String(rate),source_amount:source,gst_rate:'',discount:'0'});
  if(items.length>=80)break;
 }
 return {items,notes};
}
function findTaxAndDiscount(lines){
 const fields={source_taxable:'',source_cgst:'',source_sgst:'',source_igst:'',source_discount:'',round_off:'',gst_rate:''};
 const gstRates={cgst:'',sgst:'',igst:''};
 for(const raw of lines){
  const s=raw.replace(/^[^A-Za-z0-9]+/,'').replace(/[|\[\]]/g,' ').trim();
  const a=getAmounts(s);
  if(!a.length)continue;
  const ratePortion=s.slice(0,a.at(-1).index);const rateMatch=ratePortion.match(/(\d{1,2})[.,](\d{2})/);const printedRate=rateMatch?`${rateMatch[1]}.${rateMatch[2]}`:'';
  if(/^\s*(?:C\s*G\s*S\s*T|CGST)\b/i.test(s)) {if(!fields.source_cgst)fields.source_cgst=a.at(-1).raw;if(printedRate)gstRates.cgst=printedRate;}
  if(/^\s*(?:S\s*G\s*S\s*T|S\$?\s*GST|SGST)\b/i.test(s)) {if(!fields.source_sgst)fields.source_sgst=a.at(-1).raw;if(printedRate)gstRates.sgst=printedRate;}
  if(/^\s*I\s*G\s*S\s*T\b/i.test(s)) {if(!fields.source_igst)fields.source_igst=a.at(-1).raw;if(printedRate)gstRates.igst=printedRate;}
  if(/\b(?:sales\s*discount|trade\s*discount|less\s*[:]?\s*discount)\b/i.test(s)&&!fields.source_discount)fields.source_discount=a.at(-1).raw;
  if(/\bround\s*off\b/i.test(s)&&!fields.round_off)fields.round_off=a.at(-1).raw;
  if(/^\s*(?:taxable\s*(?:value|amount)|sub\s*total)\b/i.test(s)&&!fields.source_taxable)fields.source_taxable=a[0].raw;
 }
 // Tally HSN tax summary includes taxable value as first amount after the HSN (e.g. 6304 52,272.00 ...).
 if(!fields.source_taxable){
  const table=lines.findIndex(s=>/HSN\/SAC.*(?:Taxable|Value)/i.test(s));
  if(table>=0){for(let i=table+1;i<Math.min(table+9,lines.length);i++){
   const s=lines[i],m=s.match(/^\s*[|({]*\s*\d{4,8}\s+([\d,]+\.\d{2})/);if(m){fields.source_taxable=m[1].replace(/,/g,'');break;}
   const a=getAmounts(s).filter(x=>x.num>=100);if(!fields.source_taxable&&i<=table+4&&a.length&&a[0].num>100&&!/\b(?:total|CGST|SGST|IGST)\b/i.test(s)) {fields.source_taxable=a[0].raw;break;}
  }}
 }
 if(gstRates.cgst&&gstRates.sgst&&Number(gstRates.cgst)<=50&&Number(gstRates.sgst)<=50)fields.gst_rate=String(Number(gstRates.cgst)+Number(gstRates.sgst));
 else if(gstRates.igst&&Number(gstRates.igst)<=100)fields.gst_rate=gstRates.igst;
 return fields;
}
function gstins(lines){
 const arr=[];for(const s of lines){
  if(!/GSTIN|GSTIN.?UIN|GSTINIVIN|GSTINUIN/i.test(s))continue;
  let cleaned=s.replace(/[^A-Za-z0-9]/g,'').toUpperCase();
  for(const m of cleaned.matchAll(/\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]/g))arr.push(m[0]);
 }
 return [...new Set(arr)];
}
function buyerName(lines){
 const buyer=lines.findIndex(s=>/buyer\s*\(?\s*bill|\bbill\s*to\b/i.test(s));if(buyer<0)return '';
 for(let i=buyer+1;i<Math.min(buyer+6,lines.length);i++){
  const s=lines[i].replace(/^[^A-Za-z]+/,'').trim();if(/^(?:buyer's|dispatch|delivery|tax|state|gstin|address|road)/i.test(s)||/\d{6}/.test(s))continue;
  const m=s.match(/(?:Vijayalaxmi|Vipul|[A-Z][a-z]{3,})\s+(?:Textiles|Shegur|Industries|Traders|Yarn|Mill|Fabrics)\b/i);if(m)return m[0];
 }
 return '';
}
export function parseInvoiceText(raw,notes=[],{emptyReview,parseDate}){
 const text=String(raw??'').slice(0,150000);
 const lines=text.replace(/\r/g,'').split('\n').map(x=>x.replace(/[\t ]+/g,' ').trim()).filter(Boolean);
 const review=emptyReview();
 review.supplier_name=findSupplier(lines);
 review.invoice_number=findInvoiceNumber(lines);
 review.invoice_date=findInvoiceDate(lines,parseDate);
 const total=findTotal(lines);review.invoice_total=total.value;
 const taxes=findTaxAndDiscount(lines);
 for(const k of ['source_taxable','source_cgst','source_sgst','source_igst'])review[k]=taxes[k];
 if(taxes.round_off)review.round_off=taxes.round_off;
 review.buyer_name=buyerName(lines);
 const ids=gstins(lines);review.detected_gstins=ids;
 const buyerAt=lines.findIndex(s=>/buyer\s*\(?\s*bill|\bbill\s*to\b/i.test(s));
 const supplierHeader=lines.slice(0,buyerAt>=0?buyerAt:Math.min(lines.length,18));review.supplier_gstin=gstins(supplierHeader)[0]||'';review.buyer_gstin=buyerAt>=0?gstins(lines.slice(buyerAt))[0]||'':'';
 const items=detectedItems(lines);review.lines=items.items;
 const advisories=[];
 if(total.warning)advisories.push(total.warning);
 if(review.lines.length===1){
  const item=review.lines[0];
  if(taxes.source_discount)item.discount=taxes.source_discount;
  if(taxes.gst_rate){item.gst_rate=taxes.gst_rate;advisories.push('Single-item GST rate suggested from invoice CGST/SGST or IGST rates. Verify against original.');}
  if(!item.source_amount&&taxes.source_taxable&&taxes.source_discount){
   item.source_amount=fmt(number(taxes.source_taxable)+number(taxes.source_discount));
   advisories.push(`Item amount ₹${item.source_amount} inferred from recognized taxable amount plus printed discount; confirm against the actual item column.`);
  }
 }
 review.notes=[...notes,...items.notes,...advisories,`OCR read ${text.trim().length} characters; extracted ${[review.supplier_name,review.invoice_number,review.invoice_date,review.invoice_total].filter(Boolean).length}/4 core fields and ${review.lines.length} item row(s).`,
  'OCR values are suggestions, not verified accounting data. Confirm against the original invoice.'];
 return review;
}
