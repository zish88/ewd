import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { openDatabase } from "../server/db/schema.js";

type Token = { text: string; x: number; y: number; width: number; height: number; type: string };
const pdfPath = resolve("E:/manual/Электросхемы XC70 rus.pdf");
const pagesToTest = [55, 56, 57, 58, 59, 60];
const isColor = /^(?:RD|BK|SB|BN|BU|BL|GN|GY|GR|LGN|OG|OR|PK|P|VT|VO|WH|W|YE|Y)(?:-(?:RD|BK|SB|BN|BU|BL|GN|GY|GR|LGN|OG|OR|PK|P|VT|VO|WH|W|YE|Y))?$/;
const isPin = /^(?:[A-Z]:\d+|\d{1,2})$/;
const isBlock = /^(?:\d+\/\d+(?:[A-Z]\d*)?|ECM|CEM|BCM|DDM|PDM)$/;

function typeOf(text: string) {
  if (isColor.test(text)) return "wire";
  if (isPin.test(text)) return "pin";
  if (isBlock.test(text)) return "block";
  return "text";
}

function rows(tokens: Token[]) {
  const ordered = [...tokens].sort((a, b) => b.y - a.y || a.x - b.x);
  const result: Token[][] = [];
  for (const token of ordered) {
    const row = result.find((candidate) => Math.abs(candidate[0].y - token.y) <= 3);
    (row ?? result[result.push([]) - 1]).push(token);
  }
  return result.map((row) => row.sort((a, b) => a.x - b.x));
}

async function main() {
  const db = openDatabase();
  const manual = db.prepare("SELECT id FROM manuals WHERE source_path LIKE ? ORDER BY imported_at DESC LIMIT 1").get("%Электросхемы XC70 rus.pdf") as { id?: number } | undefined;
  if (!manual?.id) throw new Error("Сначала импортируйте русскую книгу в SQLite.");
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await readFile(pdfPath)) }).promise;
  const insertToken = db.prepare("INSERT INTO spatial_tokens(manual_id,page_number,text,x,y,width,height,token_type) VALUES(?,?,?,?,?,?,?,?)");
  const insertRoute = db.prepare("INSERT OR IGNORE INTO connector_pin_routes(page_id,connector_code,pin_number,source_code,destination_code,wire_color,function_text,raw_line,confidence,status,source_x,source_y,dest_x,dest_y) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const chains: string[] = [];

  for (const pageNumber of pagesToTest) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const tokens = content.items
      .filter((item: any) => "str" in item && item.str.trim())
      .map((item: any) => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5], width: item.width, height: item.height, type: typeOf(item.str.trim()) }));
    const pageId = db.prepare("SELECT id FROM pages WHERE manual_id=? AND source_page=?").get(manual.id, pageNumber) as { id?: number } | undefined;
    if (!pageId?.id) continue;
    db.transaction(() => tokens.forEach((token) => insertToken.run(manual.id, pageNumber, token.text, token.x, token.y, token.width, token.height, token.type)))();
    for (const row of rows(tokens)) {
      const pin = row.find((token) => token.type === "pin");
      const wire = row.find((token) => token.type === "wire");
      const blocks = row.filter((token) => token.type === "block");
      if (!pin || !wire || blocks.length < 1) continue;
      const source = blocks[0], destination = blocks.at(-1)!;
      const verified = blocks.length >= 2 && Math.abs(destination.x - source.x) > 20;
      const confidence = verified ? 1 : 0.5;
      insertRoute.run(pageId.id, "spatial", pin.text, source.text, destination.text, wire.text, row.map((token) => token.text).join(" "), row.map((token) => token.text).join(" "), confidence, verified ? "verified" : "uncertain", source.x, source.y, destination.x, destination.y);
      chains.push(`Пин ${pin.text} -> Провод ${wire.text} -> Из ${source.text} в ${destination.text} (Статус: ${verified ? "Verified" : "Uncertain"})`);
    }
  }
  console.log(chains.slice(0, 20).join("\n") || "Связи не найдены в выбранных страницах.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
