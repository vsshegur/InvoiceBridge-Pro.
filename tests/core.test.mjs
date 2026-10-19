import test from 'node:test';import assert from 'node:assert/strict';
import {COMPANIES,calculate,formatPaise,fixed,parseDate,checkReview,purchaseXML,escapeXML,extractGuess,simpleCSVRows,checkExtraction,parseTableRows} from '../src/core.mjs';
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
 const scan=`Tax Invoice\nSAMPLE YARN AND TEX\nPLOT NO 110, NEW SUNIL NAGAR\nInvoice No. Dated\n220 15-Jun-26\nBuyer (Bill to)\nVijayalaxmi Textiles\nDescription of Goods HSN/SAC Quantity Rate per Amount\n12x18 Towel 30gm 6304 2,400 PCS 7.08 PCS 17,000.00\nTotal 17,672.00`;
 const r=extractGuess(scan);assert.equal(r.supplier_name,'SAMPLE YARN AND TEX');assert.equal(r.invoice_number,'220');assert.equal(r.invoice_date,'2026-06-15');assert.equal(r.invoice_total,'17672.00');
 assert.equal(r.lines.length,1,'OCR should preserve the printed line for human verification even when displayed rate is rounded');assert.equal(Number(r.lines[0].source_amount),17000);assert.equal(r.lines[0].stock_item,'');
 assert.equal(r.supplier_ledger,'');
});
test('supplier GSTIN from header, not buyer GSTIN',()=>{
 const scan=`Supplier: ABC Textiles\nGSTIN: 27ABCDE1234F1Z7\nInvoice No. 102\nDated 15-Jun-26\nBuyer (Bill to)\nGSTIN: 27ZZZZZ1111A1Z1\nGrand Total: 1250.00`;
 const r=extractGuess(scan);assert.equal(r.supplier_gstin,'27ABCDE1234F1Z7');assert.equal(r.invoice_number,'102');assert.equal(r.invoice_date,'2026-06-15');assert.equal(r.invoice_total,'1250.00');
});
test('only matching printed item arithmetic creates an unmapped suggestion',()=>{
 const r=extractGuess(`Supplier: ABC Textiles\nInvoice No. 10\nDate: 19/10/2026\nGrand Total: 5250.00\nCotton Towel 6302 100 NOS 50.00 NOS 5000.00`);
 assert.equal(r.lines.length,1);assert.equal(r.lines[0].qty,'100');assert.equal(r.lines[0].stock_item,'');assert.equal(r.lines[0].gst_rate,'');
});

test('extraction can be reviewed with no Tally masters, no linked supplier and no stock mapping',()=>{
 const v={...base(),supplier_ledger:'',supplier_match_status:'new',lines:[{description:'12X18 Towel 30gm',qty:'2400',unit:'PCS',rate:'7.08',source_amount:'17000',gst_rate:'',stock_item:'',item_mapping_status:'pending'}],invoice_total:'17672'};
 const c=checkExtraction(v,[]);
 assert.equal(c.valid,true);assert.match(c.warnings.join(' '),/differs from quantity/);
 assert.equal(checkReview(v,[],[]).valid,false,'Tally export must still require existing masters');
});
test('extraction check identifies missing values without requiring any Tally ledger',()=>{
 const v={...base(),supplier_ledger:'',purchase_ledger:'',lines:[{description:'Towel',qty:'10',rate:'50',source_amount:'500',gst_rate:''}]};
 assert.equal(checkExtraction(v,[]).valid,true);
 v.invoice_date='';assert.equal(checkExtraction(v,[]).valid,false);
 assert.match(checkExtraction(v,[]).errors.join(' '),/Invoice date/);
});
test('spreadsheets read item rows without OCR and preserve HSN, printed amount',()=>{
 const rows=[['Invoice information','',''],['Item Name','HSN/SAC','Qty','Rate','Unit','GST %','Amount'],['Cotton Napkin','6302',10,50,'NOS',5,500]];
 const r=parseTableRows(rows);assert.equal(r.length,1);assert.equal(r[0].hsn,'6302');assert.equal(r[0].source_amount,'500');assert.equal(r[0].stock_item,'');
});
test('printed tax amounts are suggestions, not invented percentages',()=>{
 const r=extractGuess('Supplier: ABC Textile\nInvoice No. 220\nDated 15-Jun-26\nTaxable Value 16830.00\nCGST @ 2.5% 420.75\nSGST @ 2.5% 420.75\nGrand Total 17671.50');
 assert.equal(r.source_cgst,'420.75');assert.equal(r.source_sgst,'420.75');assert.equal(r.source_taxable,'16830.00');
 assert.equal(r.lines.length,0);
});
test('mismatched source amount is an extraction warning rather than disappearing from form',()=>{
 const v={...base(),lines:[{description:'Towel',qty:'2400',rate:'7.08',source_amount:'17000',unit:'PCS',gst_rate:''}]};
 const r=checkExtraction(v,[]);assert.equal(r.valid,true);assert.ok(r.warnings.some(x=>x.includes('printed ₹17000.00')));
});

import {tally405,tally411} from './fixtures-ocr.mjs';
test('actual photographed printed Tally invoice 405 OCR recovers all critical fields, figures and one item',()=>{
 const r=extractGuess(tally405);
 assert.equal(r.supplier_name,'SAMPLE YARN AND TEX');
 assert.equal(r.invoice_number,'405');
 assert.equal(r.invoice_date,'2026-09-21');
 assert.equal(r.invoice_total,'54886.00');
 assert.equal(r.source_taxable,'52272.00');
 assert.equal(r.source_cgst,'1306.80');
 assert.equal(r.source_sgst,'1306.80');
 assert.equal(r.round_off,'0.40');
 assert.equal(r.lines.length,1);
 assert.equal(r.lines[0].description,'12x18 Towel 30gm');
 assert.equal(r.lines[0].hsn,'6304');
 assert.equal(Number(r.lines[0].qty),7200);
 assert.equal(Number(r.lines[0].rate),7.33);
 assert.equal(Number(r.lines[0].source_amount),52800);
 assert.equal(Number(r.lines[0].discount),528);
 assert.equal(Number(r.lines[0].gst_rate),5);
 assert.equal(r.supplier_ledger,'');
});
test('actual Tally photo with handwritten number leaves number for manual review and detects OCR total conflict via amount in words',()=>{
 const r=extractGuess(tally411);
 assert.equal(r.supplier_name,'SAMPLE YARN AND TEX');
 assert.equal(r.invoice_number,'','unreadable handwritten invoice number must not be invented');
 assert.equal(r.invoice_date,'2026-09-26');
 assert.equal(r.invoice_total,'54885.60');
 assert.ok(r.notes.some(s=>/OCR numeric total.*disagrees/i.test(s)));
 assert.equal(r.lines.length,1);
 assert.equal(Number(r.lines[0].source_amount),52800);
 assert.equal(Number(r.lines[0].discount),528);
});
