/**
 * Render VIDA <torqueinfo> documents (tightening torque specs).
 * Often stored as escaped XML in <pre> when import didn't understand the schema.
 */
import { findCachedGraphic, parseGraphicId } from "./servicerepGraphics.js";

export type TorqueInfo = {
  docno: string;
  component: string;
  value: string;
  unit: string;
  graphicId: string | null;
  ieId: string;
};

export function parseTorqueinfoXml(xml: string): TorqueInfo | null {
  const raw = String(xml || "");
  if (!/torqueinfo/i.test(raw)) return null;
  const docno = raw.match(/\bdocno="([^"]+)"/i)?.[1] || "";
  const ieId = raw.match(/\bIE-ID="([^"]+)"/i)?.[1] || "";
  const torqueRes = raw.match(/\btorqueRes="([^"]+)"/i)?.[1] || "";
  const component =
    raw.match(/<component\b[^>]*>([\s\S]*?)<\/component>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ||
    "";
  const valueM = raw.match(/<value\b([^>]*)>([\s\S]*?)<\/value>/i);
  const value = (valueM?.[2] || "").replace(/<[^>]+>/g, "").trim();
  const unit = valueM?.[1]?.match(/\bunit="([^"]+)"/i)?.[1] || "";
  if (!docno && !component && !value) return null;
  return {
    docno,
    component,
    value,
    unit,
    graphicId: parseGraphicId(torqueRes),
    ieId,
  };
}

/** Extract torqueinfo payload from stored HTML (<pre> escaped XML or raw). */
export function extractTorqueinfoFromHtml(html: string | null | undefined): TorqueInfo | null {
  if (!html || !/torqueinfo/i.test(html)) return null;
  let xml = String(html);
  const pre = xml.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (pre) {
    xml = pre[1]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  }
  return parseTorqueinfoXml(xml);
}

export function torqueinfoDisplayTitle(info: TorqueInfo): string {
  const bits = [info.docno];
  if (info.component) bits.push(info.component);
  if (info.value) bits.push(`${info.value}${info.unit ? ` ${info.unit}` : ""}`);
  return bits.filter(Boolean).join(" · ") || "Torque";
}

export function renderTorqueinfoHtml(info: TorqueInfo, lang: "ru" | "en" = "ru"): string {
  const labelComp = lang === "en" ? "Component / fastener" : "Компонент / крепёж";
  const labelVal = lang === "en" ? "Tightening torque" : "Момент затяжки";
  const parts: string[] = [];
  parts.push(`<article class="sr-torque">`);
  if (info.docno) {
    parts.push(`<p class="sr-torque-docno"><code>${escapeHtml(info.docno)}</code></p>`);
  }
  if (info.graphicId && findCachedGraphic(info.graphicId)) {
    parts.push(
      `<figure class="sr-fig"><img src="/api/service/graphic/${info.graphicId}" alt="${escapeHtml(
        info.docno || info.graphicId,
      )}" loading="eager"/></figure>`,
    );
  }
  parts.push(`<dl class="sr-torque-dl">`);
  if (info.component) {
    parts.push(`<dt>${labelComp}</dt><dd>${escapeHtml(info.component)}</dd>`);
  }
  if (info.value) {
    const v = `${info.value}${info.unit ? ` ${info.unit}` : ""}`;
    parts.push(`<dt>${labelVal}</dt><dd><strong>${escapeHtml(v)}</strong></dd>`);
  }
  parts.push(`</dl></article>`);
  return parts.join("\n");
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** If HTML is a raw/escaped torqueinfo dump, replace with a readable card. */
export function rewriteTorqueinfoHtml(
  html: string | null,
  lang: "ru" | "en" = "ru",
): { html: string | null; title: string | null } {
  const info = extractTorqueinfoFromHtml(html);
  if (!info) return { html, title: null };
  return { html: renderTorqueinfoHtml(info, lang), title: torqueinfoDisplayTitle(info) };
}
