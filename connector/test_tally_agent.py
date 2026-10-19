import json
import tempfile
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET

from tally_agent import (ConnectorError, build_collection_xml, fetch_masters, parse_collection, save_snapshot, _local_url)

LEDGERS = '''<ENVELOPE><BODY><DATA><COLLECTION>
<LEDGER NAME="ABC Textiles"><NAME>ABC Textiles</NAME><PARENT>Sundry Creditors</PARENT><PARTYGSTIN>27AAAAA0000A1Z5</PARTYGSTIN></LEDGER>
<LEDGER NAME="GST Purchase"><NAME>GST Purchase</NAME><PARENT>Purchase Accounts</PARENT></LEDGER>
</COLLECTION></DATA></BODY></ENVELOPE>'''
ITEMS = '''<ENVELOPE><BODY><DATA><COLLECTION>
<STOCKITEM NAME="Towel 12x18"><NAME>Towel 12x18</NAME><PARENT>Towels</PARENT><BASEUNITS>PCS</BASEUNITS></STOCKITEM>
</COLLECTION></DATA></BODY></ENVELOPE>'''
UNITS = '<ENVELOPE><UNIT NAME="PCS"><SYMBOL>PCS</SYMBOL><FORMALNAME>Pieces</FORMALNAME></UNIT></ENVELOPE>'
GROUPS = '<ENVELOPE><STOCKGROUP NAME="Towels"><NAME>Towels</NAME></STOCKGROUP></ENVELOPE>'


class TallyAgentTests(unittest.TestCase):
    def test_request_explicit_company_and_safe_escaping(self):
        xml = build_collection_xml('Test & Co <Safe>', 'ledgers')
        root = ET.fromstring(xml)
        self.assertEqual(root.find('.//SVCurrentCompany').text, 'Test & Co <Safe>')
        self.assertEqual(root.find('.//COLLECTION/TYPE').text, 'Ledger')

    def test_unknown_collection_and_blank_company(self):
        with self.assertRaises(ConnectorError): build_collection_xml('Test', 'vouchers')
        with self.assertRaises(ConnectorError): build_collection_xml('', 'stock_items')

    def test_loopback_port_only(self):
        self.assertEqual(_local_url(9000), 'http://127.0.0.1:9000/')
        for port in (0, 65536, -1):
            with self.assertRaises(ConnectorError): _local_url(port)

    def test_parse_ledgers(self):
        rows = parse_collection(LEDGERS, 'ledgers')
        self.assertEqual(rows[0]['name'], 'ABC Textiles')
        self.assertEqual(rows[0]['gstin'], '27AAAAA0000A1Z5')
        self.assertEqual(len(rows), 2)

    def test_parse_stock_and_units(self):
        self.assertEqual(parse_collection(ITEMS, 'stock_items')[0]['unit'], 'PCS')
        self.assertEqual(parse_collection(UNITS, 'units')[0]['symbol'], 'PCS')
        self.assertEqual(parse_collection(GROUPS, 'stock_groups')[0]['name'], 'Towels')

    def test_parse_unsafe_and_invalid_xml(self):
        for bad in ('<!DOCTYPE x [<!ENTITY y "a">]><x>&y;</x>', '<garbled'):
            with self.assertRaises(ConnectorError): parse_collection(bad, 'ledgers')

    def test_parse_tally_lineerror(self):
        with self.assertRaisesRegex(ConnectorError, 'Tally error'):
            parse_collection('<ENVELOPE><LINEERROR>Wrong company</LINEERROR></ENVELOPE>', 'ledgers')

    def test_fetch_all_collections_and_snapshot(self):
        mapping = {'IB_LEDGER_MASTER': LEDGERS, 'IB_STOCK_MASTER': ITEMS,
                   'IB_UNIT_MASTER': UNITS, 'IB_STOCK_GROUP_MASTER': GROUPS}
        def fake_transport(body, port):
            req = ET.fromstring(body)
            self.assertEqual(req.find('.//SVCurrentCompany').text, 'Test Company')
            return mapping[req.find('.//HEADER/ID').text]
        data = fetch_masters('Test Company', transport=fake_transport)
        self.assertEqual(data['counts'], {'ledgers': 2, 'stock_items': 1, 'units': 1, 'stock_groups': 1})
        self.assertEqual(len(data['sha256']), 64)
        self.assertEqual(data['company'], 'Test Company')

    def test_empty_ledgers_is_hard_error(self):
        with self.assertRaisesRegex(ConnectorError, 'no ledgers'):
            fetch_masters('Test', transport=lambda body, port: '<ENVELOPE/>')

    def test_save_is_explicit_and_non_overwriting(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / 'masters.json'
            save_snapshot({'company': 'Test'}, p)
            self.assertEqual(json.loads(p.read_text())['company'], 'Test')
            with self.assertRaises(FileExistsError): save_snapshot({'company': 'Test'}, p)
            with self.assertRaises(ConnectorError): save_snapshot({}, Path(td) / 'masters.exe')


if __name__ == '__main__':
    unittest.main()
