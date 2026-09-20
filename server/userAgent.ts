/** Lightweight OS / browser / device label from User-Agent (no deps). */

export type UserAgentInfo = {
  os: string;
  browser: string;
  browserVersion: string;
  /** mobile | tablet | desktop | "" */
  device: string;
  /** Short admin text, e.g. "Chrome 126 · Windows · mobile" */
  label: string;
};

function pickVersion(ua: string, re: RegExp): string {
  const m = ua.match(re);
  return m?.[1] ? m[1].split(".")[0] : "";
}

export function parseUserAgent(uaRaw?: string | null): UserAgentInfo {
  const ua = String(uaRaw ?? "").trim();
  if (!ua) {
    return { os: "", browser: "", browserVersion: "", device: "", label: "" };
  }

  let os = "OS";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/CrOS/i.test(ua)) os = "ChromeOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "Browser";
  let browserVersion = "";
  if (/Edg\//i.test(ua)) {
    browser = "Edge";
    browserVersion = pickVersion(ua, /Edg\/(\d+)/i);
  } else if (/OPR\/|Opera/i.test(ua)) {
    browser = "Opera";
    browserVersion = pickVersion(ua, /(?:OPR|Opera)\/(\d+)/i);
  } else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) {
    browser = "Chrome";
    browserVersion = pickVersion(ua, /Chrome\/(\d+)/i);
  } else if (/Firefox\//i.test(ua)) {
    browser = "Firefox";
    browserVersion = pickVersion(ua, /Firefox\/(\d+)/i);
  } else if (/Safari\//i.test(ua) && /Version\//i.test(ua)) {
    browser = "Safari";
    browserVersion = pickVersion(ua, /Version\/(\d+)/i);
  }

  let device = "desktop";
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) device = "tablet";
  else if (/Mobi|iPhone|iPod|Android.*Mobile/i.test(ua)) device = "mobile";

  const browserLabel = browserVersion ? `${browser} ${browserVersion}` : browser;
  return {
    os,
    browser,
    browserVersion,
    device,
    label: `${browserLabel} · ${os} · ${device}`,
  };
}

/** Primary language tag from Accept-Language, e.g. "ru" / "en-US". */
export function parseAcceptLanguage(header?: string | null): string {
  const raw = String(header || "").trim();
  if (!raw) return "";
  const first = raw.split(",")[0]?.trim() || "";
  const tag = first.split(";")[0]?.trim() || "";
  return tag.slice(0, 16);
}
