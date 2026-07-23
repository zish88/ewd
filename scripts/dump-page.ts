import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFParse } from "pdf-parse";

const manualDir = resolve("E:/manual");
const outputPath = resolve("debug_harness_text.txt");

async function main() {
  const files = (await readdir(manualDir)).filter((name) => name.toLowerCase().endsWith(".pdf"));
  const output: string[] = [];

  for (const filename of files) {
    const parser = new PDFParse({ data: await readFile(resolve(manualDir, filename)) });
    const document = await parser.getText();
    await parser.destroy();
    const pages = document.text
      .split(/(?=--\s*\d+\s+of\s+\d+\s*--)/i)
      .filter(Boolean)
      .map((text) => ({ text, number: Number(text.match(/--\s*(\d+)\s+of\s+\d+\s*--/i)?.[1]) }))
      .filter((page) => Number.isInteger(page.number));

    const matches = pages.filter((page) => page.text.includes("74/301")).map((page) => page.number);
    console.log(`В книге ${filename} разъём найден на страницах: ${matches.length ? matches.join(", ") : "не найден"}`);

    const contextPages = new Set(matches.flatMap((page) => [page - 1, page, page + 1]));
    for (const page of pages.filter((candidate) => contextPages.has(candidate.number))) {
      output.push(`==================================================\nКНИГА: ${filename} | СТРАНИЦА: ${page.number}\n==================================================\n${page.text}`);
    }
  }
  await writeFile(outputPath, output.join("\n\n"), "utf8");
  console.log(`Сохранено ${output.length} страниц с контекстом в ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
