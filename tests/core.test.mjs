import test from 'node:test';import assert from 'node:assert/strict';
import {COMPANIES,calculate,formatPaise,fixed,parseDate,checkReview,purchaseXML,escapeXML,extractGuess,simpleCSVRows} from '../src/core.mjs';
const masters=[{kind:'ledger',name:'DEMO SUPPLIER',parent:'Sundry Creditors',gstin:''},{kind:'ledger',name:'Purchase',parent:'Purchase Accounts'},{kind:'ledger',name:'Input CGST',parent:'Duties & Taxes'},{kind:'ledger',name:'Input SGST',parent:'Duties & Taxes'},{kind:'stock',name:'Cotton Hand Towel',unit:'Nos'}];
const base=()=>({supplier_name:'DEMO SUPPLIER',supplier_ledger:'DEMO SUPPLIER',invoice_number:'241',invoice_date:'2026-10-19',supplier_gstin:'',invoice_total:'5250',purchase_ledger:'Purchase',tax_cgst_ledger:'Input CGST',tax_sgst_ledger:'Input SGST',gst_mode:'intra',freight:'0',round_off:'0',lines:[{description:'Cotton Hand Towel',stock_item:'Cotton Hand Towel',qty:'100',unit:'Nos',rate:'50',gst_rate:'5',discount:'0'}]});
test('company isolation defined',()=>assert.deepEqual(Object.keys(COMPANIES),['vipul','vijayalaxmi']));
test('money precision 2 decimals and 4 qty decimals',()=>{assert.equal(fixed('50.125',4),501250n);assert.equal(formatPaise(fixed('5.25',2)),'5.25')});
test('invalid precision rejected',()=>assert.throws(()=>fixed('5.123',2)));
test('Indian ₹ currency symbols are parsed',()=>assert.equal(fixed('₹1,250.50',2),125050n));
test('demo invoice reconciles exactly',()=>{const x=calculate(base()).totals;assert.equal(x.taxable,500000n);assert.equal(x.cgst,12500n);assert.equal(x.sgst,12500n);assert.equal(x.grand,525000n)});
test('interstate GST uses IGST',()=>{const v={...base(),gst_mode:'inter',tax_igst_ledger:'Input IGST'};const x=calculate(v).totals;assert.equal(x.igst,25000n);assert.equal(x.cgst,0n);});
test('rounding is half up',()=>{const v=base();v.lines[0]={...v.lines[0],qty:'1',rate:'1.0050',gst_rate:'0'};const x=calculate(v).totals;assert.equal(x.taxable,101n)});
test('discount is deducted before GST',()=>{const v=base();v.lines[0].discount='100';const x=calculate(v).totals;assert.equal(x.taxable,490000n);assert.equal(x.grand,514500n)});
test('valid review passes',()=>assert.equal(checkReview(base(),masters,[]).valid,true));
test('no Tally master blocks',()=>assert.equal(checkReview(base(),[],[]).valid,false));
test('unmatched supplier ledger blocks',()=>{const v=base();v.supplier_ledger='Unknown';assert.equal(checkReview(v,masters,[]).valid,false)});
test('wrong stock unit blocks',()=>{const v=base();v.lines[0].unit='KG';assert.match(checkReview(v,masters,[]).errors.join(' '),/unit differs/)});
test('duplicate invoice is rejected',()=>{const v=base();assert.match(checkReview(v,masters,[{id:'other',review:v}],'current').errors.join(' '),/Duplicate/)});
test('source grand total mismatch blocks',()=>{const v=base();v.invoice_total='5235';assert.match(checkReview(v,masters,[]).errors.join(' '),/reconcile/)});
test('bad date or GST rate rejected',()=>{assert.equal(parseDate('31/02/2026'),'');const v=base();v.lines[0].gst_rate='120';assert.equal(checkReview(v,masters,[]).valid,false)});
test('purchase XML includes Tally voucher amount and supplier',()=>{const xml=purchaseXML(base(),'VIPUL TEXTILES');assert.match(xml,/<SVCURRENTCOMPANY>VIPUL TEXTILES<\/SVCURRENTCOMPANY>/);assert.match(xml,/<AMOUNT>5250.00<\/AMOUNT>/);assert.match(xml,/<STOCKITEMNAME>Cotton Hand Towel<\/STOCKITEMNAME>/)});
test('XML escapes tags in voucher number',()=>{const v=base();v.invoice_number='X&<42>';assert.match(purchaseXML(v,'VIPUL TEXTILES'),/X&amp;&lt;42&gt;/);assert.equal(escapeXML('<&>'),'&lt;&amp;&gt;')});
test('basic extraction never approves a voucher',()=>{const x=extractGuess('Supplier: DEMO SUPPLIER\nInvoice No: 241\nDate: 19/10/2026\nGrand Total: 5250');assert.equal(x.invoice_number,'241');assert.equal(x.invoice_date,'2026-10-19');assert.equal(x.supplier_ledger,'');assert.equal(x.lines.length,0)});
test('CSV row parsing requires explicit ledger matching',()=>{const rows=simpleCSVRows('Item,Qty,Rate\nCotton Hand Towel,100,50\nGrand Total,5250');assert.equal(rows.length,1);assert.equal(rows[0].stock_item,'')});
test('negative freight and out-of-range quantity rejected',()=>{const v=base();v.freight='-3';assert.throws(()=>calculate(v));v.freight='0';v.lines[0].qty='0';assert.throws(()=>calculate(v))});

test('printed Tally column header OCR extracts invoice details without Supplier: label',()=>{
 const scan=`Tax Invoice\nGAYATRI YARN AND TEX\nPLOT NO 110, NEW SUNIL NAGAR\nInvoice No. Dated\n220 15-Jun-26\nBuyer (Bill to)\nVijayalaxmi Textiles\nDescription of Goods HSN/SAC Quantity Rate per Amount\n12x18 Towel 30gm 6304 2,400 PCS 7.08 PCS 17,000.00\nTotal 17,672.00`;
 const r=extractGuess(scan);assert.equal(r.supplier_name,'GAYATRI YARN AND TEX');assert.equal(r.invoice_number,'220');assert.equal(r.invoice_date,'2026-06-15');assert.equal(r.invoice_total,'17672.00');
 assert.equal(r.lines.length,0,'OCR must not invent rows where quantity * rate differs from printed amount');
 assert.equal(r.supplier_ledger,'');
});
test('supplier GSTIN from header, not buyer GSTIN',()=>{
 const scan=`Supplier: ABC Textiles\nGSTIN: 27ABCDE1234F1Z7\nInvoice No. 102\nDated 15-Jun-26\nBuyer (Bill to)\nGSTIN: 27ZZZZZ1111A1Z1\nGrand Total: 1250.00`;
 const r=extractGuess(scan);assert.equal(r.supplier_gstin,'27ABCDE1234F1Z7');assert.equal(r.invoice_number,'102');assert.equal(r.invoice_date,'2026-06-15');assert.equal(r.invoice_total,'1250.00');
});
test('only matching printed item arithmetic creates an unmapped suggestion',()=>{
 const r=extractGuess(`Supplier: ABC Textiles\nInvoice No. 10\nDate: 19/10/2026\nGrand Total: 5250.00\nCotton Towel 6302 100 NOS 50.00 NOS 5000.00`);
 assert.equal(r.lines.length,1);assert.equal(r.lines[0].qty,'100');assert.equal(r.lines[0].stock_item,'');assert.equal(r.lines[0].gst_rate,'0');
});
