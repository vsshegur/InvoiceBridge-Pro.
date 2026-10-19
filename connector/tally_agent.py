"""InvoiceBridge Tally connector - read-only experimental Windows application.

This module never creates, modifies or deletes any Tally vouchers or masters.
It contacts only the locally running Tally HTTP/XML endpoint. No cloud code.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import threading
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from xml.sax.saxutils import escape

MAX_RESPONSE_BYTES = 12 * 1024 * 1024
COLLECTIONS = {
    "ledgers": ("Ledger", ("Name", "Parent", "PartyGSTIN", "GSTRegistrationType")),
    "stock_items": ("Stock Item", ("Name", "Parent", "BaseUnits", "GSTApplicable", "GSTDetails")),
    "units": ("Unit", ("Symbol", "FormalName", "IsSimpleUnit", "NumberOfDecimalPlaces")),
    "stock_groups": ("Stock Group", ("Name", "Parent")),
}
COLLECTION_NAMES = {
    "ledgers": "IB_LEDGER_MASTER",
    "stock_items": "IB_STOCK_MASTER",
    "units": "IB_UNIT_MASTER",
    "stock_groups": "IB_STOCK_GROUP_MASTER",
}
OBJECT_TAG = {
    "ledgers": "LEDGER",
    "stock_items": "STOCKITEM",
    "units": "UNIT",
    "stock_groups": "STOCKGROUP",
}
FIELD_NAMES = {
    "ledgers": {"name": "NAME", "parent": "PARENT", "gstin": "PARTYGSTIN", "gst_registration_type": "GSTREGISTRATIONTYPE"},
    "stock_items": {"name": "NAME", "parent": "PARENT", "unit": "BASEUNITS", "gst_applicable": "GSTAPPLICABLE"},
    "units": {"symbol": "SYMBOL", "formal_name": "FORMALNAME", "simple": "ISSIMPLEUNIT", "decimals": "NUMBEROFDECIMALPLACES"},
    "stock_groups": {"name": "NAME", "parent": "PARENT"},
}


class ConnectorError(Exception):
    """Expected recoverable configuration / Tally / data error."""


def _xml_string(s: str) -> str:
    return escape(s, {'"': '&quot;', "'": '&apos;'})


def build_collection_xml(company: str, kind: str) -> bytes:
    """A TDL collection query sent via Tally's Export Collection XML gateway.

    Company is explicit to prevent mixing masters from distinct open companies.
    Tally versions vary: test the requested collection tags with your release.
    """
    if kind not in COLLECTIONS:
        raise ConnectorError("Unsupported master collection")
    if not company or not company.strip() or len(company) > 180:
        raise ConnectorError("Select one non-empty Tally company")
    obj_type, fields = COLLECTIONS[kind]
    coll_name = COLLECTION_NAMES[kind]
    # The <FETCH> list is deliberately bounded; don't read vouchers or contacts.
    xml = ("<ENVELOPE><HEADER><VERSION>1</VERSION>"
           "<TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE>"
           f"<ID>{coll_name}</ID></HEADER><BODY><DESC><STATICVARIABLES>"
           f"<SVCurrentCompany>{_xml_string(company.strip())}</SVCurrentCompany>"
           "<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>"
           "</STATICVARIABLES><TDL><TDLMESSAGE>"
           f'<COLLECTION NAME="{coll_name}" ISMODIFY="No">'
           f"<TYPE>{obj_type}</TYPE><FETCH>{','.join(fields)}</FETCH>"
           "</COLLECTION>"
           "</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>")
    return xml.encode("utf-8")


def _local_url(port: int) -> str:
    if not 1 <= port <= 65535:
        raise ConnectorError("Invalid local Tally port")
    return f"http://127.0.0.1:{port}/"


def tally_request(body: bytes, port: int = 9000, timeout: float = 15.0) -> str:
    """Contact localhost ONLY; avoid remote or untrusted endpoints."""
    request = urllib.request.Request(
        _local_url(port), data=body, method="POST",
        headers={"Content-Type": "application/xml; charset=utf-8", "Accept": "application/xml"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if response.status != 200:
                raise ConnectorError(f"Tally returned HTTP {response.status}")
            content = response.read(MAX_RESPONSE_BYTES + 1)
    except (urllib.error.URLError, TimeoutError) as exc:
        raise ConnectorError("Cannot reach Tally on this computer. Open the correct company and enable its HTTP integration port.") from exc
    if len(content) > MAX_RESPONSE_BYTES:
        raise ConnectorError("Tally response is unexpectedly large; operation stopped")
    return content.decode("utf-8-sig", errors="replace")


def _local_tag(tag: str) -> str:
    return tag.split("}")[-1].upper()


def _field(node: ET.Element, name: str) -> str:
    for child in node:
        if _local_tag(child.tag) == name:
            return (child.text or "").strip()
    return ""


def parse_collection(raw: str, kind: str) -> list[dict[str, str]]:
    if kind not in OBJECT_TAG:
        raise ConnectorError("Unknown collection type")
    if "<!DOCTYPE" in raw.upper() or "<!ENTITY" in raw.upper():
        raise ConnectorError("XML document declarations are not accepted")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise ConnectorError("Tally returned malformed XML") from exc
    for node in root.iter():
        if _local_tag(node.tag) == "LINEERROR" and (node.text or "").strip():
            raise ConnectorError("Tally error: " + (node.text or "").strip()[:250])
    found = []
    for node in root.iter():
        if _local_tag(node.tag) != OBJECT_TAG[kind]:
            continue
        record = {key: _field(node, tag) for key, tag in FIELD_NAMES[kind].items()}
        if kind in {"ledgers", "stock_items", "stock_groups"} and not record.get("name"):
            record["name"] = node.attrib.get("NAME", "").strip()
        if kind == "units" and not record.get("symbol"):
            record["symbol"] = node.attrib.get("NAME", "").strip()
        if record.get("name") or record.get("symbol"):
            found.append(record)
    # Duplicate objects are occasionally returned from composite TDL collections.
    dedup = {}
    primary = "symbol" if kind == "units" else "name"
    for obj in found:
        key = obj[primary].casefold()
        if key not in dedup:
            dedup[key] = obj
    return sorted(dedup.values(), key=lambda x: x[primary].casefold())


def fetch_masters(company: str, *, port: int = 9000,
                  transport: Callable[[bytes, int], str] | None = None,
                  progress: Callable[[str], None] = lambda _s: None) -> dict:
    """Obtain masters read-only for a *single explicitly chosen* Tally company."""
    company = company.strip()
    if not company:
        raise ConnectorError("Enter the exact company name shown in Tally")
    result = {}
    for kind in COLLECTIONS:
        progress(f"Reading {kind.replace('_', ' ')} for {company}…")
        raw = (transport or (lambda body, p: tally_request(body, p)))(build_collection_xml(company, kind), port)
        result[kind] = parse_collection(raw, kind)
    if not result["ledgers"]:
        raise ConnectorError("Tally returned no ledgers. Confirm exact company, port, permissions and Tally version; refusing an empty master snapshot.")
    canonical = json.dumps({"company": company, "masters": result}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return {
        "schema": "invoicebridge-master-snapshot/1",
        "company": company,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "sha256": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        "counts": {k: len(v) for k, v in result.items()},
        "masters": result,
    }


def save_snapshot(snapshot: dict, destination: Path) -> Path:
    # Save locally only after user clicks Export; never upload to cloud.
    if destination.suffix.lower() != ".json":
        raise ConnectorError("Export path must have a .json extension")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("x", encoding="utf-8") as fp:
        json.dump(snapshot, fp, indent=2, ensure_ascii=False)
    return destination


def start_gui() -> None:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
    root = tk.Tk()
    root.title("InvoiceBridge Tally Connector — Read-only prototype")
    root.geometry("820x520")
    outer = ttk.Frame(root, padding=24)
    outer.pack(fill="both", expand=True)
    ttk.Label(outer, text="InvoiceBridge Tally Connector", font=("Segoe UI", 18, "bold")).pack(anchor="w")
    ttk.Label(outer, text="Read-only master export prototype — cannot change Tally data").pack(anchor="w", pady=(6, 20))
    details = ttk.Frame(outer)
    details.pack(fill="x")
    ttk.Label(details, text="Exact open Tally company:").grid(row=0, column=0, sticky="w", pady=8)
    company_var = tk.StringVar()
    ttk.Entry(details, textvariable=company_var, width=52).grid(row=0, column=1, sticky="ew", padx=12)
    ttk.Label(details, text="Tally HTTP port:").grid(row=1, column=0, sticky="w", pady=8)
    port_var = tk.StringVar(value="9000")
    ttk.Entry(details, textvariable=port_var, width=15).grid(row=1, column=1, sticky="w", padx=12)
    details.columnconfigure(1, weight=1)
    status = tk.StringVar(value="Tally must be running with the correct company open.")
    ttk.Label(outer, textvariable=status, wraplength=750).pack(anchor="w", pady=(24, 8))
    log = tk.Text(outer, height=9, wrap="word")
    log.pack(fill="both", expand=True)
    log.insert("end", "No documents or vouchers will be sent to Tally.\n")
    log.configure(state="disabled")
    last = {"snapshot": None}
    row = ttk.Frame(outer)
    row.pack(fill="x", pady=(20, 0))
    export_btn = ttk.Button(row, text="Save master snapshot (.json)", state="disabled")
    export_btn.pack(side="right", padx=(8, 0))
    sync_btn = ttk.Button(row, text="Read masters from Tally")
    sync_btn.pack(side="right")
    def set_log(text: str):
        def run():
            log.configure(state="normal")
            log.insert("end", text + "\n")
            log.see("end")
            log.configure(state="disabled")
            status.set(text)
        root.after(0, run)
    def do_read():
        company = company_var.get().strip()
        try:
            port = int(port_var.get())
            _local_url(port)
            if not company:
                raise ConnectorError("Enter the exact Tally company name")
        except (ValueError, ConnectorError) as exc:
            messagebox.showerror("Configuration", str(exc))
            return
        sync_btn.configure(state="disabled")
        export_btn.configure(state="disabled")
        def worker():
            try:
                snapshot = fetch_masters(company, port=port, progress=set_log)
                last["snapshot"] = snapshot
                set_log("Masters read successfully: " + ", ".join(f"{count} {name}" for name, count in snapshot["counts"].items()))
                root.after(0, lambda: export_btn.configure(state="normal"))
            except Exception as exc:
                last["snapshot"] = None
                set_log(f"Unable to fetch masters: {exc}")
            finally:
                root.after(0, lambda: sync_btn.configure(state="normal"))
        threading.Thread(target=worker, daemon=True).start()
    def do_export():
        if not last["snapshot"]:
            return
        name = re.sub(r"[^A-Za-z0-9_-]", "_", last["snapshot"]["company"])[:60]
        selected = filedialog.asksaveasfilename(defaultextension=".json", initialfile=f"InvoiceBridge_{name}_masters.json", filetypes=[("JSON snapshot", "*.json")])
        if not selected:
            return
        try:
            save_snapshot(last["snapshot"], Path(selected))
            messagebox.showinfo("Saved locally", f"Master snapshot saved at:\n{selected}\n\nDo not publish this file to a public GitHub repository.")
        except (ConnectorError, FileExistsError, OSError) as exc:
            messagebox.showerror("Save error", str(exc))
    sync_btn.configure(command=do_read)
    export_btn.configure(command=do_export)
    root.mainloop()


def main() -> None:
    parser = argparse.ArgumentParser(description="InvoiceBridge - local, read-only Tally master connector")
    parser.add_argument("--company", help="Exact company name open in TallyPrime")
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("--export", type=Path, help="New .json file path. Never overwrites existing files.")
    args = parser.parse_args()
    if not args.company:
        start_gui()
        return
    try:
        s = fetch_masters(args.company, port=args.port, progress=print)
        print(json.dumps({"company": s["company"], "counts": s["counts"], "sha256": s["sha256"]}, indent=2))
        if args.export:
            save_snapshot(s, args.export)
            print("Saved to", args.export)
    except ConnectorError as exc:
        parser.exit(2, f"Error: {exc}\n")


if __name__ == "__main__":
    main()
