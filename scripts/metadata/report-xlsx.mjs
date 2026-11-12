#!/usr/bin/env node
// Writes db/metadata/metadata-review.xlsx from db/metadata/enrichment.json and summary.json. No dependencies: OOXML parts
// in a deflate ZIP. Sheets: Summary (totals and legend), Tools (one row per tool, filterable, header frozen).
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

const OUT = "db/metadata";
const rows = JSON.parse(readFileSync(`${OUT}/enrichment.json`, "utf8"));
const sum = JSON.parse(readFileSync(`${OUT}/summary.json`, "utf8"));
const esc = (s) => String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (n) => { let s = ""; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const cell = (ref, v, st) => (typeof v === "number" ? `<c r="${ref}" s="${st}"><v>${v}</v></c>` : `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v ?? "").slice(0, 32000))}</t></is></c>`);
const sheet = (cols, data, { header = true, filter = false } = {}) => {
  const last = colName(cols.length - 1);
  const body = data.map((r, i) => `<row r="${i + 1}">${r.map((v, c) => cell(`${colName(c)}${i + 1}`, v, i === 0 && header ? 1 : 2)).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${header ? `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` : ""}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${body}</sheetData>${filter ? `<autoFilter ref="A1:${last}${data.length}"/>` : ""}</worksheet>`;
};
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF5353F1"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const COLS = [["slug", 26], ["name", 24], ["url", 30], ["category", 22], ["subcategory", 28], ["tool_status", 10], ["pricing_model", 12], ["pricing_status", 13], ["pricing_basis", 26], ["pricing_source", 34], ["checked_at", 11], ["evidence", 60], ["notes", 40], ["tags", 30], ["tag_basis", 50], ["final_url", 30]];
const toolsData = [COLS.map((c) => c[0]), ...rows.map((r) => COLS.map(([k]) => (Array.isArray(r[k]) ? r[k].join("; ") : r[k] ?? "")))];
const S = [["TryAITools metadata review", ""], ["Generated", sum.generated_at], ["Tools", sum.tools], ["", ""], ["Pricing model", "Tools"]];
for (const [k, v] of Object.entries(sum.pricing_by_model)) S.push([k, v]);
S.push(["", ""], ["Pricing status", "Tools"]);
for (const [k, v] of Object.entries(sum.pricing_by_status)) S.push([k, v]);
S.push(["", ""], ["Pricing basis", "Tools"]);
for (const [k, v] of Object.entries(sum.pricing_by_basis)) S.push([k, v]);
S.push(["Flagged REVIEW", sum.review_flagged], ["", ""], ["Tools with tags", sum.tools_with_tags], ["", ""], ["Tag", "Tools"]);
for (const [k, v] of Object.entries(sum.tag_usage).sort((a, b) => b[1] - a[1])) S.push([k, v]);
S.push(["", ""], ["Legend", ""], ["verified", "Evidence on the official page (or owner/manual review) supports the label. Imported."], ["unknown", "Page read but the label is unclear. Not imported (no badge): Pending Review."], ["failed", "Page could not be read (blocked, script-rendered, unreachable, robots.txt). Not imported: Pending Review."], ["REVIEW in notes", "Verified but inferred from wording worth a second look (e.g. Paid = no free/trial wording at all)."]);

const sheets = [["Summary", sheet([28, 90], S, { header: false })], ["Tools", sheet(COLS.map((c) => c[1]), toolsData, { filter: true })]];
const files = {
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([n], i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${`<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="1" hidden="1">Tools!$A$1:$${colName(COLS.length - 1)}$${toolsData.length}</definedName></definedNames>`}</workbook>`,
  "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  "xl/styles.xml": STYLES,
};
sheets.forEach(([, xml], i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = xml));

const table = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const local = [], central = [];
let off = 0;
for (const [name, text] of Object.entries(files)) {
  const data = Buffer.from(text, "utf8"), comp = deflateRawSync(data, { level: 9 }), nb = Buffer.from(name, "utf8"), crc = crc32(data);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);
  lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26); lh.writeUInt16LE(0, 28);
  local.push(lh, nb, comp);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
  ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(0, 30); ch.writeUInt32LE(0, 34); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(off, 42);
  central.push(ch, nb);
  off += 30 + nb.length + comp.length;
}
const cd = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
writeFileSync(`${OUT}/metadata-review.xlsx`, Buffer.concat([...local, cd, end]));
console.log("xlsx rows:", rows.length, "bytes:", statSync(`${OUT}/metadata-review.xlsx`).size);
