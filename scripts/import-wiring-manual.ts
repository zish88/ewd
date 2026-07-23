import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { classifyPageType, openDatabase } from "../server/db/schema.js";

const sourcePath = process.argv[2] ? resolve(process.argv[2]) : "";
if (!sourcePath) throw new Error("Укажите путь к PDF первым аргументом.");

const argument = (name: string) => process.argv[process.argv.indexOf(name) + 1];
const metadata = {
  title: argument("--title") ?? "Volvo wiring manual",
  model: argument("--model") ?? "XC70",
  year: argument("--year") ?? "2008",
  engines: (argument("--engines") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
};

type SpatialToken = { text: string; x: number; y: number; width: number; height: number };
let insertTokenStmt: any;
let insertRouteStmt: any;

function parseSpatialData(pageTokens: SpatialToken[], pageId: number, manualId: number, pageNumber: number) {
  let verified = 0, uncertain = 0;
  for (const token of pageTokens) {
    const type = /^[A-C]:\d+$/.test(token.text) ? "pin" : /^(?:[A-Z]{2,})(?:-[A-Z]{2,})?$/.test(token.text) ? "wire" : /^\d+\/\d+$/.test(token.text) ? "component" : "block";
    insertTokenStmt.run(manualId, pageNumber, token.text, token.x, token.y, token.width, token.height, type);
  }
  const rows: SpatialToken[][] = [];
  for (const token of [...pageTokens].sort((a,b)=>b.y-a.y)) {
    const row = rows.find((candidate) => Math.abs(candidate[0].y-token.y)<=4);
    (row ?? rows[rows.push([])-1]).push(token);
  }
  for (const row of rows) {
    row.sort((a,b)=>a.x-b.x);
    const text=row.map((token)=>token.text).join(" ");
    const components=text.match(/\b(?:\d{1,2}\/\d{1,4}|ECM|CEM|TCM|BCM|DDM|PDM|KVM)\b/g)??[];
    const pins=text.match(/\b(?:[A-C]:\d+|\d{1,2})\b/g)??[];
    const colors=text.match(/\b(?:BU-WH|YE-VT|BK-YE|VT-BN|GN-VT|BN|WH|GN|BU|VT|GY|YE|RD|SB|OG)\b/g)??[];
    if (!components.length || !colors.length) continue;
    const status=components.length>=2||(components.length===1&&pins.length)?"verified":"uncertain";
    const confidence=status==="verified"?1:0.5;
    status==="verified"?verified++:uncertain++;
    const x=row.reduce((sum,t)=>sum+t.x,0)/row.length, y=row.reduce((sum,t)=>sum+t.y,0)/row.length;
    insertRouteStmt.run(pageId,pins[0]??"1",colors[0],components[0],components[1]??components[0],components[2]??components[0],null,text,confidence,status,x,y,x,y);
  }
  return { verified, uncertain };
}

async function main() {
  const db = openDatabase();
  const upsertManual = db.prepare(`
    INSERT INTO manuals(title, revision, source_path, model, year, engines_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_path) DO UPDATE SET
      title=excluded.title, model=excluded.model, year=excluded.year,
      engines_json=excluded.engines_json, imported_at=CURRENT_TIMESTAMP
    RETURNING id
  `);
  const manualId = (upsertManual.get(metadata.title, metadata.year, sourcePath, metadata.model, metadata.year, JSON.stringify(metadata.engines)) as { id: number }).id;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await readFile(sourcePath)) }).promise;
  const upsertPage = db.prepare(`
    INSERT INTO pages(manual_id, source_page, printed_page, system_name, text, page_type)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(manual_id, source_page) DO UPDATE SET
      text=excluded.text,
      system_name=excluded.system_name,
      page_type=excluded.page_type
    RETURNING id
  `);
  insertTokenStmt = db.prepare("INSERT INTO spatial_tokens(manual_id,page_number,text,x,y,width,height,token_type) VALUES(?,?,?,?,?,?,?,?)");
  insertRouteStmt = db.prepare("INSERT OR IGNORE INTO connector_pin_routes(page_id,pin_number,wire_color,source_code,destination_code,connector_code,function_text,raw_line,confidence,status,source_x,source_y,dest_x,dest_y) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const clear = db.transaction(() => {
    db.prepare("DELETE FROM spatial_tokens WHERE manual_id = ?").run(manualId);
    db.prepare("DELETE FROM connector_pin_routes WHERE page_id IN (SELECT id FROM pages WHERE manual_id = ?)").run(manualId);
    db.prepare("DELETE FROM pages WHERE manual_id = ?").run(manualId);
  });
  clear();
  const importBook = db.transaction((pages: Array<{ number: number; tokens: SpatialToken[] }>) => {
    for (const page of pages) {
      const pageText = page.tokens.map((token) => token.text).join(" ");
      const systemName = page.tokens.slice(0, 16).map((token) => token.text).join(" ").slice(0, 160) || null;
      const pageType = classifyPageType(systemName, pageText);
      const pageId = Number((upsertPage.get(manualId, page.number, String(page.number), systemName, pageText, pageType) as { id: number }).id);
      const counts = parseSpatialData(page.tokens, pageId, manualId, page.number);
      console.log(`Страница ${page.number} [${pageType}]: verified ${counts.verified}, uncertain ${counts.uncertain}`);
    }
  });
  const pages: Array<{ number: number; tokens: SpatialToken[] }> = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const content = await (await pdf.getPage(number)).getTextContent();
    pages.push({ number, tokens: content.items.filter((item: any) => item.str?.trim()).map((item: any) => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5], width: item.width, height: item.height })) });
  }
  importBook(pages);
  console.log(`Книга ${metadata.title}: создано ${pages.length} страниц.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
