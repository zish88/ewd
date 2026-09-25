import { useEffect, useRef, useState } from "react";
import {
  applySiteAppearance,
  type SiteAppearance,
  type ThemeId,
  type UiDensity,
} from "./appearance.js";
import { ObdAdapterPanel } from "./obd/ObdAdapterPanel.js";
import { ObdElmPanel } from "./obd/ObdElmPanel.js";

type AdminTab = "stats" | "settings" | "edits" | "obd" | "kb";

type Features = {
  suggestions: boolean;
  ewdDiagrams: boolean;
  vinSearch: boolean;
  navBrowse: boolean;
  dtcSearch: boolean;
  obdAdapter: boolean;
  kbComments: boolean;
};

type Settings = {
  siteOpen: boolean;
  features: Features;
  appearance: SiteAppearance;
  updatedAt?: string;
};

const DEFAULT_APPEARANCE: SiteAppearance = {
  defaultTheme: "caspian",
  colors: {},
  fontFamily: "",
  fontUrl: "",
  radiusMd: "",
  radiusLg: "",
  cardPadding: "",
  cardGap: "",
  cardTitleSize: "",
  appBarHeight: "",
  chipFontSize: "",
  btnMinHeight: "",
  uiDensity: "normal",
};

const COLOR_FIELDS: Array<{ key: keyof NonNullable<SiteAppearance["colors"]>; label: string }> = [
  { key: "accent", label: "Accent" },
  { key: "bgMain", label: "Фон сайта" },
  { key: "bgCard", label: "Фон карточки" },
  { key: "textMain", label: "Текст" },
  { key: "textMuted", label: "Приглушённый" },
  { key: "border", label: "Рамка" },
  { key: "cta", label: "CTA кнопка" },
];

type VisitStats = {
  today: number;
  yesterday: number;
  week: number;
  month: number;
  total: number;
  online30m: number;
  filtered?: number | null;
  filterFrom?: string | null;
  filterTo?: string | null;
  recent: Array<{
    id: number;
    visitedAt: string;
    path: string;
    uaLabel?: string;
    lang?: string;
    referrer?: string;
    device?: string;
    country?: string;
    timezone?: string;
    screen?: string;
  }>;
};

type Ticket = {
  id: number;
  created_at: string;
  model: string;
  year: string;
  engine: string;
  location_name: string;
  pin_number: string;
  wire_color: string;
  source_block: string;
  destination_block: string;
  description: string;
  status: string;
  wire_id: number | null;
  subject_code: string;
  zone: string;
  card_url: string;
  user_comment: string;
  admin_note?: string;
};

type WireRow = {
  id: number;
  pin_number: string;
  wire_color_raw: string;
  wire_color_ru: string;
  function_text: string;
  from_detail: string;
  to_detail: string;
  from_code: string | null;
  to_code: string | null;
  subject_code: string;
  harness_left: string;
  harness_right: string;
};

type WireForm = {
  pin_number: string;
  wire_color_raw: string;
  function_text: string;
  from_detail: string;
  to_detail: string;
  from_code: string;
  to_code: string;
  subject_code: string;
  harness_left: string;
  harness_right: string;
};

const FEATURE_LABELS: Record<keyof Features, string> = {
  suggestions: "Предложения правок с карточек (почта)",
  ewdDiagrams: "Графические схемы EWD",
  vinSearch: "Поиск по VIN",
  navBrowse: "Навигация по зонам и узлам",
  dtcSearch: "Поиск DTC / OBD кодов",
  obdAdapter: "Скан с адаптера OBD (ESP32) — сейчас не влияет: кнопка временно снята с сайта, тест на вкладке OBD",
  kbComments: "Комментарии в базе знаний",
};

const ADMIN_UI_SESSION_KEY = "ewd_admin_ui";
const ADMIN_TABS: Array<{ key: AdminTab; label: string }> = [
  { key: "stats", label: "Статистика" },
  { key: "settings", label: "Настройки" },
  { key: "edits", label: "Правки" },
  { key: "kb", label: "База знаний" },
  { key: "obd", label: "OBD" },
];

function parseAdminTab(value: string | null): AdminTab {
  return value === "settings" || value === "edits" || value === "obd" || value === "stats" || value === "kb"
    ? value
    : "stats";
}

function normalizeAppearance(appearance?: SiteAppearance | null): SiteAppearance {
  return {
    ...DEFAULT_APPEARANCE,
    ...(appearance || {}),
    colors: { ...DEFAULT_APPEARANCE.colors, ...(appearance?.colors || {}) },
  };
}

const emptyWireForm = (): WireForm => ({
  pin_number: "",
  wire_color_raw: "",
  function_text: "",
  from_detail: "",
  to_detail: "",
  from_code: "",
  to_code: "",
  subject_code: "",
  harness_left: "",
  harness_right: "",
});

function formatVisitAt(isoLike: string): string {
  const normalized = /Z$|[+-]\d{2}:?\d{2}$/.test(isoLike) ? isoLike : `${isoLike.replace(" ", "T")}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return isoLike;
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function wireToForm(w: WireRow): WireForm {
  return {
    pin_number: String(w.pin_number || ""),
    wire_color_raw: String(w.wire_color_raw || ""),
    function_text: String(w.function_text || ""),
    from_detail: String(w.from_detail || ""),
    to_detail: String(w.to_detail || ""),
    from_code: String(w.from_code || ""),
    to_code: String(w.to_code || ""),
    subject_code: String(w.subject_code || ""),
    harness_left: String(w.harness_left || ""),
    harness_right: String(w.harness_right || ""),
  };
}

export function AdminPage() {
  const [configured, setConfigured] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    if (typeof window === "undefined") return "stats";
    return parseAdminTab(new URLSearchParams(window.location.search).get("tab"));
  });
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draftSettings, setDraftSettings] = useState<Settings | null>(null);
  const [visits, setVisits] = useState<VisitStats | null>(null);
  const [visitFrom, setVisitFrom] = useState("");
  const [visitTo, setVisitTo] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketCounts, setTicketCounts] = useState<Record<string, number>>({});
  const [ticketFilter, setTicketFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [currentWire, setCurrentWire] = useState<WireRow | null>(null);
  const [editForm, setEditForm] = useState<WireForm>(emptyWireForm());
  const [editWireId, setEditWireId] = useState("");
  const [editPanelOpen, setEditPanelOpen] = useState(false);
  const [editActionBadge, setEditActionBadge] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const editBadgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncInfo, setSyncInfo] = useState<{
    today: number;
    lastSync: { ran_at: string; applied_count: number; note: string } | null;
  } | null>(null);
  const [pushStats, setPushStats] = useState<{
    configured: boolean;
    subscribers: number;
  } | null>(null);
  const [form, setForm] = useState({
    subject_code: "",
    pin_number: "",
    from_code: "",
    to_code: "",
    wire_color_raw: "",
    harness_left: "",
    component_code: "",
    name_ru: "",
  });
  const [obdSubTab, setObdSubTab] = useState<"elm" | "esp">("elm");
  const [kbSubs, setKbSubs] = useState<
    Array<{
      id: number;
      created_at: string;
      status: string;
      kind: string;
      platform: string;
      topic: string;
      title: string;
      summary: string;
      body_md: string;
      source_url: string;
      author_name: string;
      published_slug: string;
      admin_note?: string;
    }>
  >([]);
  const [kbFilter, setKbFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [kbCounts, setKbCounts] = useState<Record<string, number>>({});
  const [kbBusyId, setKbBusyId] = useState<number | null>(null);
  const [kbSelected, setKbSelected] = useState<number[]>([]);
  const [kbCollector, setKbCollector] = useState<{
    publishedArticles: number;
    pendingDrafts: number;
    seeds: number;
    cacheMb: number;
    urls: { queued: number; done: number; error: number; skipped: number };
    config: { maxNewDraftsPerRun: number; maxPendingDrafts: number; maxPublishedArticles: number };
    seedsList: Array<{ id: number; url: string; platform: string; topic: string; status: string }>;
    lastRun: { mode: string; report: Record<string, unknown> } | null;
  } | null>(null);
  const [kbSeedUrl, setKbSeedUrl] = useState("");
  const [kbSeedMsg, setKbSeedMsg] = useState("");
  const [kbSeedPlatform, setKbSeedPlatform] = useState("p3");
  const [kbSeedTopic, setKbSeedTopic] = useState("parts");
  const [kbCollectMode, setKbCollectMode] = useState<"online" | "offline" | "dry-run">("online");
  const [kbCollectBusy, setKbCollectBusy] = useState(false);
  const [kbComments, setKbComments] = useState<
    Array<{
      id: number;
      created_at: string;
      article_slug: string;
      author_name: string;
      body: string;
    }>
  >([]);
  const [kbCommentBusyId, setKbCommentBusyId] = useState<number | null>(null);

  async function refreshMe() {
    const r = await fetch("/api/admin/me", { credentials: "include" });
    const d = await r.json();
    setConfigured(Boolean(d.configured));
    setAdmin(Boolean(d.admin));
    return Boolean(d.admin);
  }

  async function loadSettings() {
    const r = await fetch("/api/admin/settings", { credentials: "include" });
    if (!r.ok) return;
    const d = (await r.json()) as Settings;
    d.appearance = normalizeAppearance(d.appearance);
    d.features = {
      suggestions: d.features?.suggestions !== false,
      ewdDiagrams: d.features?.ewdDiagrams !== false,
      vinSearch: d.features?.vinSearch !== false,
      navBrowse: d.features?.navBrowse !== false,
      dtcSearch: d.features?.dtcSearch !== false,
      obdAdapter: d.features?.obdAdapter !== false,
      kbComments: d.features?.kbComments !== false,
    };
    setSettings(d);
    setDraftSettings(d);
    applySiteAppearance(d.appearance);
  }

  async function loadVisits(from = visitFrom, to = visitTo) {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const qs = q.toString();
    const r = await fetch(`/api/admin/visits${qs ? `?${qs}` : ""}`, { credentials: "include" });
    if (!r.ok) return;
    setVisits((await r.json()) as VisitStats);
  }

  async function loadTickets(status: typeof ticketFilter = ticketFilter) {
    const r = await fetch(`/api/admin/tickets?status=${status}&limit=80`, { credentials: "include" });
    if (!r.ok) return;
    const d = (await r.json()) as { tickets: Ticket[]; counts: Record<string, number> };
    setTickets(d.tickets || []);
    setTicketCounts(d.counts || {});
  }

  async function loadCorrections() {
    const r = await fetch("/api/admin/corrections", { credentials: "include" });
    if (!r.ok) return;
    const d = await r.json();
    setSyncInfo({ today: Number(d.today) || 0, lastSync: d.lastSync || null });
  }

  async function loadPushStats() {
    const r = await fetch("/api/admin/push/stats", { credentials: "include" });
    if (!r.ok) return;
    const d = (await r.json()) as { configured?: boolean; subscribers?: number };
    setPushStats({
      configured: Boolean(d.configured),
      subscribers: Number(d.subscribers) || 0,
    });
  }

  async function loadKbSubmissions(status: typeof kbFilter = kbFilter) {
    const r = await fetch(`/api/admin/knowledge/submissions?status=${status}`, { credentials: "include" });
    if (!r.ok) return;
    const d = (await r.json()) as {
      submissions?: typeof kbSubs;
      counts?: Record<string, number>;
    };
    setKbSubs(Array.isArray(d.submissions) ? d.submissions : []);
    setKbCounts(d.counts || {});
    setKbSelected([]);
  }

  async function loadKbCollector() {
    const r = await fetch("/api/admin/knowledge/collector/status", { credentials: "include" });
    if (!r.ok) return;
    const d = await r.json();
    if (d?.ok) {
      setKbCollector({
        publishedArticles: Number(d.publishedArticles) || 0,
        pendingDrafts: Number(d.pendingDrafts) || 0,
        seeds: Number(d.seeds) || 0,
        cacheMb: Number(d.cacheMb) || 0,
        urls: d.urls || { queued: 0, done: 0, error: 0, skipped: 0 },
        config: {
          maxNewDraftsPerRun: Number(d.config?.maxNewDraftsPerRun) || 10,
          maxPendingDrafts: Number(d.config?.maxPendingDrafts) || 40,
          maxPublishedArticles: Number(d.config?.maxPublishedArticles) || 400,
        },
        seedsList: Array.isArray(d.seedsList) ? d.seedsList : [],
        lastRun: d.lastRun || null,
      });
    }
  }

  async function addKbSeed() {
    setKbSeedMsg("");
    setNotice("");
    const text = kbSeedUrl.trim();
    if (!text) {
      setKbSeedMsg("Вставьте одну или несколько ссылок (с новой строки).");
      return;
    }
    try {
      const r = await fetch("/api/admin/knowledge/collector/seeds", {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          platform: kbSeedPlatform,
          topic: kbSeedTopic,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.ok === false) {
        const err =
          d.error ||
          (Array.isArray(d.failed) && d.failed[0]?.error) ||
          `Ошибка ${r.status}`;
        setKbSeedMsg(String(err));
        setNotice(String(err));
        return;
      }
      const added = Number(d.added ?? (d.seed ? 1 : 0));
      const failedN = Array.isArray(d.failed) ? d.failed.length : 0;
      const msg =
        added > 0
          ? `Добавлено seeds: ${added}${failedN ? `, ошибок: ${failedN}` : ""}`
          : failedN
            ? `Не добавлено. ${d.failed.map((f: { error: string }) => f.error).join("; ")}`
            : "Нечего добавлять";
      setKbSeedMsg(msg);
      setNotice(msg);
      if (added > 0) setKbSeedUrl("");
      await loadKbCollector();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Сеть / JSON ошибка";
      setKbSeedMsg(msg);
      setNotice(msg);
    }
  }

  async function runKbCollector() {
    setKbCollectBusy(true);
    setNotice("");
    try {
      const r = await fetch("/api/admin/knowledge/collector/run", {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: kbCollectMode, maxNew: kbCollector?.config.maxNewDraftsPerRun || 10 }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        setNotice(d.error || "Сборщик не запустился");
        return;
      }
      const rep = d.report || {};
      setNotice(
        `Сборщик (${rep.mode}): +${rep.created || 0} черновиков, skip ${rep.skipped || 0}, err ${rep.errors || 0}` +
          (rep.quotaStop ? ` · стоп: ${rep.quotaStop}` : ""),
      );
      await loadKbCollector();
      await loadKbSubmissions("pending");
      setKbFilter("pending");
    } finally {
      setKbCollectBusy(false);
    }
  }

  async function batchApproveKb() {
    if (kbSelected.length === 0) return;
    setNotice("");
    const r = await fetch("/api/admin/knowledge/submissions/batch-approve", {
      credentials: "include",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: kbSelected }),
    });
    const d = await r.json();
    if (!r.ok) {
      setNotice(d.error || "Batch approve failed");
      return;
    }
    setNotice(`Опубликовано: ${(d.approved || []).length}, ошибок: ${(d.failed || []).length}`);
    await loadKbSubmissions();
    await loadKbCollector();
  }

  async function moderateKb(id: number, action: "approve" | "reject") {
    setKbBusyId(id);
    setNotice("");
    try {
      const r = await fetch(`/api/admin/knowledge/submissions/${id}/${action}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "" }),
      });
      const d = await r.json();
      if (!r.ok) {
        setNotice(d.error || "Ошибка модерации БЗ");
        return;
      }
      setNotice(
        action === "approve"
          ? `Опубликовано: ${d.submission?.published_slug || `#${id}`}`
          : `Отклонено #${id}`,
      );
      await loadKbSubmissions();
    } finally {
      setKbBusyId(null);
    }
  }

  async function loadKbComments() {
    const r = await fetch("/api/admin/knowledge/comments?limit=100", { credentials: "include" });
    if (!r.ok) return;
    const d = (await r.json()) as { comments?: typeof kbComments };
    setKbComments(Array.isArray(d.comments) ? d.comments : []);
  }

  async function deleteKbComment(id: number) {
    setKbCommentBusyId(id);
    setNotice("");
    try {
      const r = await fetch(`/api/admin/knowledge/comments/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const d = await r.json();
      if (!r.ok) {
        setNotice(d.error || "Не удалось удалить комментарий");
        return;
      }
      setKbComments((prev) => prev.filter((c) => c.id !== id));
      setNotice(`Комментарий #${id} удалён`);
    } finally {
      setKbCommentBusyId(null);
    }
  }

  function flashEditBadge(tone: "ok" | "bad", text: string) {
    if (editBadgeTimer.current) clearTimeout(editBadgeTimer.current);
    setEditActionBadge({ tone, text });
    editBadgeTimer.current = setTimeout(() => setEditActionBadge(null), 2800);
  }

  function clearEditWorkspace() {
    setActiveTicket(null);
    setCurrentWire(null);
    setEditForm(emptyWireForm());
    setEditWireId("");
    setEditPanelOpen(false);
  }

  async function openTicket(id: number) {
    setNotice("");
    const r = await fetch(`/api/admin/tickets/${id}`, { credentials: "include" });
    const d = await r.json();
    if (!r.ok) {
      setNotice(d.error || "Не удалось открыть заявку");
      return;
    }
    const ticket = d.ticket as Ticket;
    setActiveTicket(ticket);
    const wire = (d.wire || null) as WireRow | null;
    setCurrentWire(wire);
    if (wire) {
      setEditWireId(String(wire.id));
      setEditForm(wireToForm(wire));
    } else {
      setEditWireId(ticket.wire_id ? String(ticket.wire_id) : "");
      setEditForm({
        ...emptyWireForm(),
        pin_number: ticket.pin_number || "",
        wire_color_raw: ticket.wire_color || "",
        function_text: ticket.description || "",
        from_detail: ticket.source_block || "",
        to_detail: ticket.destination_block || "",
        subject_code: ticket.subject_code || ticket.location_name || "",
      });
    }
    if (ticket.status === "pending" || wire || ticket.wire_id) {
      setEditPanelOpen(true);
    }
  }

  async function loadWireById() {
    const id = Number(editWireId);
    if (!id) {
      setNotice("Укажите ID карточки (wire id)");
      return;
    }
    const r = await fetch(`/api/admin/wires/${id}`, { credentials: "include" });
    const d = await r.json();
    if (!r.ok) {
      setNotice(d.error || "Провод не найден");
      setCurrentWire(null);
      return;
    }
    const wire = d.wire as WireRow;
    setCurrentWire(wire);
    setEditForm(wireToForm(wire));
    setEditPanelOpen(true);
    setNotice(`Карточка #${wire.id} загружена`);
  }

  async function saveWireEdit() {
    const id = Number(editWireId);
    if (!id) {
      setNotice("Нужен ID карточки для сохранения");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const ticketId = activeTicket?.id ?? null;
      const r = await fetch(`/api/admin/wires/${id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editForm,
          ticket_id: ticketId,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setNotice(d.error || "Ошибка сохранения");
        return;
      }
      await loadTickets();
      await loadCorrections();
      if (ticketId) {
        clearEditWorkspace();
        const msg = `Заявка #${ticketId} одобрена`;
        setNotice(msg);
        flashEditBadge("ok", msg);
      } else {
        setCurrentWire(d.wire as WireRow);
        setNotice(`Сохранено · карточка #${id} (сайт обновлён сразу)`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function rejectTicket() {
    if (!activeTicket) return;
    const ticketId = activeTicket.id;
    const r = await fetch(`/api/admin/tickets/${ticketId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "rejected" }),
    });
    const d = await r.json();
    if (!r.ok) {
      setNotice(d.error || "Не удалось отклонить");
      return;
    }
    clearEditWorkspace();
    const msg = `Заявка #${ticketId} отклонена`;
    setNotice(msg);
    flashEditBadge("bad", msg);
    await loadTickets();
  }

  async function runSyncNow() {
    const r = await fetch("/api/admin/corrections/sync", {
      method: "POST",
      credentials: "include",
    });
    const d = await r.json();
    if (!r.ok) {
      setNotice(d.error || "Синхронизация не удалась");
      return;
    }
    setNotice(`Ночной накат вручную: applied=${d.applied}, skipped=${d.skipped}`);
    await loadCorrections();
  }

  async function logoutServer() {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    try {
      sessionStorage.removeItem(ADMIN_UI_SESSION_KEY);
    } catch {
      /* ignore */
    }
    // Drop unsaved draft preview; keep last saved tokens for the public site.
    if (settings) applySiteAppearance(settings.appearance);
    setAdmin(false);
    setSettings(null);
    setDraftSettings(null);
    setVisits(null);
    setTickets([]);
    setActiveTicket(null);
  }

  useEffect(() => {
    void (async () => {
      let uiOk = false;
      try {
        uiOk = sessionStorage.getItem(ADMIN_UI_SESSION_KEY) === "1";
      } catch {
        uiOk = false;
      }
      if (!uiOk) {
        await logoutServer();
        const r = await fetch("/api/admin/me", { credentials: "include" });
        const d = await r.json();
        setConfigured(Boolean(d.configured));
        setAdmin(false);
        return;
      }
      const ok = await refreshMe();
      if (ok) {
        await loadSettings();
        await loadVisits();
        await loadTickets();
        await loadCorrections();
        await loadPushStats();
      } else {
        try {
          sessionStorage.removeItem(ADMIN_UI_SESSION_KEY);
        } catch {
          /* ignore */
        }
      }
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (editBadgeTimer.current) clearTimeout(editBadgeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", activeTab);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [activeTab]);

  useEffect(() => {
    if (!admin || activeTab !== "kb") return;
    void loadKbSubmissions(kbFilter);
    void loadKbComments();
    void loadKbCollector();
  }, [admin, activeTab, kbFilter]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setNotice("");
    const r = await fetch("/api/admin/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const d = await r.json();
    if (!r.ok) {
      setNotice(d.error || "Ошибка входа");
      return;
    }
    try {
      sessionStorage.setItem(ADMIN_UI_SESSION_KEY, "1");
    } catch {
      /* ignore */
    }
    setPassword("");
    setAdmin(true);
    setNotice("Вход выполнен");
    await loadSettings();
    await loadVisits();
    await loadTickets();
    await loadCorrections();
    await loadPushStats();
  }

  async function saveSettings(next: Settings) {
    const r = await fetch("/api/admin/settings", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    const d = await r.json();
    if (!r.ok) {
      setNotice(d.error || "Не удалось сохранить");
      return;
    }
    const saved = d as Settings;
    saved.appearance = normalizeAppearance(saved.appearance);
    setSettings(saved);
    setDraftSettings(saved);
    applySiteAppearance(saved.appearance);
    setNotice("Настройки сохранены");
  }

  function mergeAppearance(patch: Partial<SiteAppearance>): SiteAppearance {
    const cur = draftSettings?.appearance || DEFAULT_APPEARANCE;
    return {
      ...DEFAULT_APPEARANCE,
      ...cur,
      ...patch,
      colors: { ...(cur.colors || {}), ...(patch.colors || {}) },
    };
  }

  function updateDraftSettings(patch: Partial<Settings>) {
    if (!draftSettings) return;
    setDraftSettings({ ...draftSettings, ...patch });
  }

  function updateDraftFeatures(key: keyof Features, value: boolean) {
    if (!draftSettings) return;
    setDraftSettings({
      ...draftSettings,
      features: { ...draftSettings.features, [key]: value },
    });
  }

  function updateDraftAppearance(patch: Partial<SiteAppearance>) {
    if (!draftSettings) return;
    const appearance = mergeAppearance(patch);
    setDraftSettings({ ...draftSettings, appearance });
    applySiteAppearance(appearance);
  }

  const inputClass = "rounded border border-[var(--border-color)] bg-[var(--input-bg)] px-2 py-1.5 w-full";
  const settingsDirty = Boolean(
    settings && draftSettings && JSON.stringify(draftSettings) !== JSON.stringify(settings),
  );

  return (
    <main className="min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] px-4 py-6">
      <div className="mx-auto max-w-3xl md:max-w-5xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-[var(--accent)]">Админ · Volvo EWD</h1>
          <a
            href="/"
            className="text-xs underline text-[var(--text-muted)]"
            onClick={() => {
              void logoutServer();
            }}
          >
            ← На сайт
          </a>
        </div>

        {!admin ? (
          <form onSubmit={login} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3">
            <p className="text-sm text-[var(--text-muted)]">
              {configured
                ? "Войдите паролем ADMIN_PASSWORD, чтобы управлять доступом к сайту."
                : "На сервере не задан ADMIN_PASSWORD — поле входа отключено, пока пароль не попадёт в контейнер."}
            </p>
            {!configured ? (
              <div className="rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 space-y-1.5 font-mono whitespace-pre-wrap">
                {`# на VPS в консоли хостинга:
nano /opt/ewd-app/.env
# строка (без кавычек, без пробелов вокруг =):
ADMIN_PASSWORD=ваш_секрет

# пересоздать контейнер (достаточно без BUILD):
cd /opt/ewd-app && bash deploy.sh

# проверка (должно быть "adminConfigured":true):
curl -s http://127.0.0.1:3000/api/health | head -c 400`}
              </div>
            ) : null}
            <input
              type="password"
              className="w-full rounded border border-[var(--border-color)] bg-[var(--input-bg)] px-3 py-2 text-sm disabled:opacity-50"
              placeholder="Пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!configured}
              autoComplete="current-password"
            />
            <button type="submit" className="w-full rounded bg-emerald-600 text-white py-2 text-sm font-medium disabled:opacity-50" disabled={!configured}>
              Войти
            </button>
          </form>
        ) : (
          <>
            <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1" role="tablist" aria-label="Разделы админки">
                  {ADMIN_TABS.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === tab.key}
                      className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                        activeTab === tab.key
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-[var(--border-color)] text-[var(--text-muted)]"
                      }`}
                      onClick={() => setActiveTab(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                {settingsDirty && activeTab === "settings" ? (
                  <span className="text-xs font-medium text-amber-700">Есть несохранённые изменения</span>
                ) : null}
              </div>
              {notice ? <p className="text-sm text-amber-700">{notice}</p> : null}
            </section>

            {activeTab === "edits" ? (
              <>
            <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Заявки на правку</h2>
                <div className="flex flex-wrap gap-1 text-xs">
                  {(["pending", "approved", "rejected", "all"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`rounded px-2 py-1 border ${
                        ticketFilter === s
                          ? "border-emerald-600 text-emerald-700"
                          : "border-[var(--border-color)] text-[var(--text-muted)]"
                      }`}
                      onClick={() => {
                        setTicketFilter(s);
                        void loadTickets(s);
                      }}
                    >
                      {s === "pending"
                        ? `Ожидают (${ticketCounts.pending || 0})`
                        : s === "approved"
                          ? `Приняты (${ticketCounts.approved || 0})`
                          : s === "rejected"
                            ? `Отклонены (${ticketCounts.rejected || 0})`
                            : "Все"}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Откройте заявку → сверьте с карточкой → правьте поля → SAVE. На сайте видно сразу. Ночью (03:00–05:00 МСК)
                все админ-правки повторно накладываются на БД (чтобы не пропали после fixdb).
              </p>
              {tickets.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">Нет заявок в этом фильтре.</p>
              ) : (
                <ul className="max-h-56 overflow-y-auto divide-y divide-[var(--border-color)] text-sm">
                  {tickets.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        className={`w-full text-left py-2 px-1 hover:bg-[var(--input-bg)] ${
                          activeTicket?.id === t.id ? "bg-[var(--input-bg)]" : ""
                        }`}
                        onClick={() => void openTicket(t.id)}
                      >
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">
                            #{t.id} · {t.subject_code || t.location_name}
                            {t.wire_id ? ` · wire#${t.wire_id}` : ""}
                          </span>
                          <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
                            {formatVisitAt(t.created_at)}
                          </span>
                        </div>
                        <div className="text-xs text-[var(--text-muted)] truncate">
                          {t.model} {t.year} · пин {t.pin_number} · {t.wire_color} · {t.description}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3 text-xs">
              <details
                className="group"
                open={editPanelOpen}
                onToggle={(e) => setEditPanelOpen(e.currentTarget.open)}
              >
                <summary className="cursor-pointer list-none flex items-center justify-between gap-2 select-none [&::-webkit-details-marker]:hidden">
                  <span className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Правка карточки
                    <span className="ml-2 text-[10px] font-normal normal-case text-[var(--text-muted)]">
                      {editPanelOpen ? "▾" : "▸"}
                    </span>
                  </span>
                  {editActionBadge ? (
                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        editActionBadge.tone === "ok"
                          ? "bg-emerald-600/15 text-emerald-700"
                          : "bg-red-600/15 text-red-700"
                      }`}
                    >
                      {editActionBadge.text}
                    </span>
                  ) : null}
                </summary>

                <div className="mt-3 space-y-3">
                  {activeTicket ? (
                    <div className="rounded-lg border border-amber-600/40 bg-amber-500/5 p-3 space-y-1 text-sm">
                      <div className="font-medium text-amber-800 dark:text-amber-200">
                        Заявка #{activeTicket.id} · {activeTicket.status}
                      </div>
                      <div className="text-[var(--text-muted)]">
                        Авто: {activeTicket.model}, {activeTicket.year}, {activeTicket.engine}
                        {activeTicket.zone ? ` · зона ${activeTicket.zone}` : ""}
                      </div>
                      <div>
                        Предложение: пин <strong>{activeTicket.pin_number}</strong>, цвет{" "}
                        <strong>{activeTicket.wire_color}</strong>
                      </div>
                      <div>
                        Откуда: {activeTicket.source_block} → Куда: {activeTicket.destination_block}
                      </div>
                      <div>Описание: {activeTicket.description}</div>
                      {activeTicket.user_comment ? <div>Комментарий: {activeTicket.user_comment}</div> : null}
                      {activeTicket.card_url ? (
                        <a
                          className="text-emerald-700 underline break-all"
                          href={activeTicket.card_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Открыть карточку на сайте
                        </a>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-[var(--text-muted)]">Выберите заявку слева или загрузите карточку по ID.</p>
                  )}

                  <div className="flex gap-2 items-end">
                    <label className="flex-1 space-y-1">
                      <span className="text-[10px] uppercase text-[var(--muted)]">Wire ID</span>
                      <input
                        className={inputClass}
                        value={editWireId}
                        onChange={(e) => {
                          setEditWireId(e.target.value);
                          if (e.target.value.trim()) setEditPanelOpen(true);
                        }}
                        onFocus={() => {
                          if (editWireId.trim() || activeTicket?.status === "pending") setEditPanelOpen(true);
                        }}
                        placeholder="например 1636"
                      />
                    </label>
                    <button
                      type="button"
                      className="rounded border border-[var(--border-color)] px-3 py-1.5"
                      onClick={() => void loadWireById()}
                    >
                      Загрузить
                    </button>
                  </div>

                  {currentWire ? (
                    <p className="text-[var(--text-muted)]">
                      Сейчас в БД: #{currentWire.id} · {currentWire.subject_code} · пин {currentWire.pin_number} ·{" "}
                      {currentWire.wire_color_raw}
                    </p>
                  ) : null}

                  {editWireId.trim() || activeTicket?.status === "pending" ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          className={inputClass}
                          placeholder="subject 74/411"
                          value={editForm.subject_code}
                          onChange={(e) => setEditForm({ ...editForm, subject_code: e.target.value })}
                        />
                        <input
                          className={inputClass}
                          placeholder="Пин"
                          value={editForm.pin_number}
                          onChange={(e) => setEditForm({ ...editForm, pin_number: e.target.value })}
                        />
                        <input
                          className={inputClass}
                          placeholder="Цвет (GN-YE)"
                          value={editForm.wire_color_raw}
                          onChange={(e) => setEditForm({ ...editForm, wire_color_raw: e.target.value })}
                        />
                        <input
                          className={inputClass}
                          placeholder="Harness"
                          value={editForm.harness_left}
                          onChange={(e) => setEditForm({ ...editForm, harness_left: e.target.value })}
                        />
                        <input
                          className={inputClass}
                          placeholder="Откуда (код)"
                          value={editForm.from_code}
                          onChange={(e) => setEditForm({ ...editForm, from_code: e.target.value })}
                        />
                        <input
                          className={inputClass}
                          placeholder="Куда (код)"
                          value={editForm.to_code}
                          onChange={(e) => setEditForm({ ...editForm, to_code: e.target.value })}
                        />
                        <input
                          className={`${inputClass} col-span-2`}
                          placeholder="Откуда (текст)"
                          value={editForm.from_detail}
                          onChange={(e) => setEditForm({ ...editForm, from_detail: e.target.value })}
                        />
                        <input
                          className={`${inputClass} col-span-2`}
                          placeholder="Куда (текст)"
                          value={editForm.to_detail}
                          onChange={(e) => setEditForm({ ...editForm, to_detail: e.target.value })}
                        />
                        <input
                          className={`${inputClass} col-span-2`}
                          placeholder="Описание / function"
                          value={editForm.function_text}
                          onChange={(e) => setEditForm({ ...editForm, function_text: e.target.value })}
                        />
                      </div>

                      <div className="flex flex-col sm:flex-row gap-2">
                        <button
                          type="button"
                          disabled={saving || !editWireId.trim()}
                          className="flex-1 rounded bg-emerald-600 text-white py-2.5 text-sm font-semibold disabled:opacity-50"
                          onClick={() => void saveWireEdit()}
                        >
                          {saving ? "Сохранение…" : "SAVE · обновить карточку"}
                        </button>
                        {activeTicket?.status === "pending" ? (
                          <button
                            type="button"
                            className="rounded border border-red-500/50 text-red-700 px-3 py-2"
                            onClick={() => void rejectTicket()}
                          >
                            Отклонить заявку
                          </button>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              </details>
            </section>
              </>
            ) : null}

            {activeTab === "stats" ? (
              <>
            <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Посещения</h2>
                <button type="button" className="text-xs text-emerald-500 hover:underline" onClick={() => void loadVisits()}>
                  Обновить
                </button>
              </div>
              {visits ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {(
                      [
                        ["Сегодня", visits.today],
                        ["Вчера", visits.yesterday],
                        ["Онлайн", visits.online30m],
                        ["Неделя", visits.week],
                        ["Месяц", visits.month],
                        ["Всего", visits.total],
                      ] as const
                    ).map(([label, n]) => (
                      <div key={label} className="rounded-lg border border-[var(--border-color)] px-3 py-2.5 min-h-[4.25rem]">
                        <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
                        <div className="text-2xl font-semibold tabular-nums text-[var(--accent)] leading-tight mt-0.5">{n}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-end gap-2 pt-1">
                    <label className="text-xs text-[var(--text-muted)] space-y-1">
                      <span className="block uppercase tracking-wide text-[10px] text-[var(--muted)]">С</span>
                      <input
                        type="date"
                        value={visitFrom}
                        onChange={(e) => setVisitFrom(e.target.value)}
                        className="rounded-md border border-[var(--border-color)] bg-[var(--bg-main)] px-2 py-1.5 text-sm text-[var(--text-main)]"
                      />
                    </label>
                    <label className="text-xs text-[var(--text-muted)] space-y-1">
                      <span className="block uppercase tracking-wide text-[10px] text-[var(--muted)]">По</span>
                      <input
                        type="date"
                        value={visitTo}
                        onChange={(e) => setVisitTo(e.target.value)}
                        className="rounded-md border border-[var(--border-color)] bg-[var(--bg-main)] px-2 py-1.5 text-sm text-[var(--text-main)]"
                      />
                    </label>
                    <button
                      type="button"
                      className="rounded-md border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-main)] hover:border-emerald-500"
                      onClick={() => void loadVisits(visitFrom, visitTo)}
                    >
                      Применить
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-2 py-1.5 text-xs text-[var(--text-muted)] hover:underline"
                      onClick={() => {
                        setVisitFrom("");
                        setVisitTo("");
                        void loadVisits("", "");
                      }}
                    >
                      Сбросить
                    </button>
                    {visits.filtered != null ? (
                      <span className="text-xs text-[var(--text-muted)] ml-auto tabular-nums">
                        В периоде: <strong className="text-[var(--accent)]">{visits.filtered}</strong>
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Онлайн — уникальные сессии за 30 мин. Сегодня/вчера и фильтр — календарные сутки UTC. Сырой IP не
                    хранится; страна — только если прокси отдаёт CF/Vercel country.
                  </p>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)] pt-1">Когда заходили</h3>
                  {visits.recent.length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)]">Пока нет записей.</p>
                  ) : (
                    <ul className="max-h-56 md:max-h-80 overflow-y-auto divide-y divide-[var(--border-color)] text-sm">
                      {visits.recent.map((v) => {
                        const meta = [
                          v.uaLabel,
                          v.lang,
                          v.country,
                          v.timezone,
                          v.screen,
                          v.referrer ? `← ${v.referrer}` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ");
                        return (
                          <li key={v.id} className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                            <span className="tabular-nums text-[var(--text-main)] shrink-0">{formatVisitAt(v.visitedAt)}</span>
                            <span className="truncate text-[var(--text-muted)] text-xs min-w-0" title={meta || undefined}>
                              {meta || "—"}
                            </span>
                            <span className="truncate text-[var(--text-muted)] font-mono text-xs shrink-0 sm:max-w-[8rem]">
                              {v.path || "/"}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">Загрузка…</p>
              )}
            </section>

            <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3 text-sm">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Сводка</h2>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-[var(--border-color)] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Правок сегодня</div>
                  <div className="text-xl font-semibold tabular-nums text-[var(--accent)]">{syncInfo?.today ?? "—"}</div>
                </div>
                <div className="rounded-lg border border-[var(--border-color)] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Заявки ждут</div>
                  <div className="text-xl font-semibold tabular-nums text-[var(--accent)]">{ticketCounts.pending || 0}</div>
                </div>
                <div className="rounded-lg border border-[var(--border-color)] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Приняты</div>
                  <div className="text-xl font-semibold tabular-nums text-[var(--accent)]">{ticketCounts.approved || 0}</div>
                </div>
              </div>
              <div className="rounded-lg border border-[var(--border-color)] p-3 space-y-1 text-[var(--text-muted)]">
                <div>
                  Последний ночной/ручной накат:{" "}
                  {syncInfo?.lastSync
                    ? `${formatVisitAt(syncInfo.lastSync.ran_at)} · ${syncInfo.lastSync.applied_count} · ${syncInfo.lastSync.note}`
                    : "ещё не было"}
                </div>
                <button type="button" className="text-emerald-700 underline" onClick={() => void runSyncNow()}>
                  Накатить оверлей сейчас
                </button>
              </div>
              <div className="rounded-lg border border-[var(--border-color)] p-3 space-y-2">
                <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Web Push</div>
                <div className="text-[var(--text-muted)]">
                  {pushStats == null
                    ? "Загрузка…"
                    : pushStats.configured
                      ? `Подписчиков: ${pushStats.subscribers}`
                      : "VAPID не настроен на сервере — пуши выключены (на VPS: bash scripts/setup-vapid.sh)"}
                </div>
                {pushStats?.configured ? (
                  <p className="text-[11px] text-[var(--muted)] leading-snug">
                    sent&gt;0 значит сервер доставил пуш в браузер. Баннер — в Windows (центр уведомлений),
                    не в админке. Если тоста нет: Параметры → Система → Уведомления → Google Chrome
                    (баннеры вкл), выключите «Фокусировку». На сайте выключите/включите «Уведомления».
                  </p>
                ) : null}
                <button
                  type="button"
                  className="rounded border border-[var(--border-color)] px-3 py-1.5 text-emerald-700 disabled:opacity-50"
                  disabled={!pushStats?.configured || (pushStats.subscribers || 0) < 1}
                  onClick={() => {
                    void (async () => {
                      const r = await fetch("/api/admin/push/test", {
                        method: "POST",
                        credentials: "include",
                      });
                      const d = (await r.json()) as {
                        error?: string;
                        hint?: string;
                        sent?: number;
                        failed?: number;
                        pruned?: number;
                        errors?: Array<{ status?: number; message?: string }>;
                      };
                      if (!r.ok && d.error) {
                        setNotice(d.error);
                        return;
                      }
                      const summary = `Тест пуша: sent=${d.sent ?? 0}, failed=${d.failed ?? 0}, pruned=${d.pruned ?? 0}`;
                      const detail =
                        d.hint ||
                        (d.errors?.[0]
                          ? `${d.errors[0].status || "?"} ${d.errors[0].message || ""}`.trim()
                          : "");
                      setNotice(detail ? `${summary}. ${detail}` : summary);
                      await loadPushStats();
                    })();
                  }}
                >
                  Тестовое уведомление
                </button>
              </div>
            </section>
              </>
            ) : null}

            {activeTab === "settings" ? (
              <>
            <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Доступность сайта</h2>
              {draftSettings ? (
                <>
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>Сайт открыт для посетителей</span>
                    <input
                      type="checkbox"
                      checked={draftSettings.siteOpen}
                      onChange={(e) => updateDraftSettings({ siteOpen: e.target.checked })}
                    />
                  </label>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)] pt-2">Функции</h3>
                  <ul className="space-y-2">
                    {(Object.keys(FEATURE_LABELS) as Array<keyof Features>).map((key) => (
                      <label key={key} className="flex items-center justify-between gap-3 text-sm">
                        <span>{FEATURE_LABELS[key]}</span>
                        <input
                          type="checkbox"
                          checked={draftSettings.features[key]}
                          onChange={(e) => updateDraftFeatures(key, e.target.checked)}
                        />
                      </label>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">Загрузка настроек…</p>
              )}
            </section>

            <section
              className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3"
              data-testid="admin-appearance"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Внешний вид</h2>
                {draftSettings ? (
                  <button
                    type="button"
                    className="md-btn md-btn--text text-[11px] px-2 py-1"
                    onClick={() => {
                      const appearance = { ...DEFAULT_APPEARANCE };
                      setDraftSettings({ ...draftSettings, appearance });
                      applySiteAppearance(appearance);
                    }}
                  >
                    Сбросить к пресету
                  </button>
                ) : null}
              </div>
              {draftSettings?.appearance ? (
                <>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Тема по умолчанию для новых посетителей; цвета и размеры перекрывают пресет на всём сайте.
                  </p>
                  <label className="block space-y-1 text-sm">
                    <span className="text-[10px] uppercase text-[var(--muted)]">Тема по умолчанию</span>
                    <select
                      className={inputClass}
                      value={draftSettings.appearance.defaultTheme || "caspian"}
                      onChange={(e) =>
                        updateDraftAppearance({ defaultTheme: e.target.value as ThemeId })
                      }
                    >
                      <option value="caspian">Caspian</option>
                      <option value="charcoal">Charcoal</option>
                      <option value="amber">Amber</option>
                    </select>
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span className="text-[10px] uppercase text-[var(--muted)]">Плотность UI</span>
                    <select
                      className={inputClass}
                      value={draftSettings.appearance.uiDensity || "normal"}
                      onChange={(e) =>
                        updateDraftAppearance({ uiDensity: e.target.value as UiDensity })
                      }
                    >
                      <option value="compact">Компактная</option>
                      <option value="normal">Обычная</option>
                      <option value="comfortable">Просторная</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {COLOR_FIELDS.map(({ key, label }) => {
                      const val = draftSettings.appearance.colors?.[key] || "";
                      return (
                        <label key={key} className="flex items-center gap-2 text-sm">
                          <input
                            type="color"
                            className="h-9 w-10 shrink-0 cursor-pointer rounded border border-[var(--border-color)] bg-transparent"
                            value={/^#[0-9a-f]{6}$/i.test(val) ? val : "#34d399"}
                            onChange={(e) =>
                              updateDraftAppearance({
                                colors: { ...(draftSettings.appearance.colors || {}), [key]: e.target.value },
                              })
                            }
                          />
                          <span className="min-w-[5.5rem] text-[11px] text-[var(--text-muted)]">{label}</span>
                          <input
                            className={`${inputClass} font-mono text-[11px]`}
                            placeholder="#hex"
                            value={val}
                            onChange={(e) =>
                              updateDraftAppearance({
                                colors: {
                                  ...(draftSettings.appearance.colors || {}),
                                  [key]: e.target.value.trim(),
                                },
                              })
                            }
                          />
                        </label>
                      );
                    })}
                  </div>
                  <label className="block space-y-1 text-sm">
                    <span className="text-[10px] uppercase text-[var(--muted)]">Шрифт (CSS stack)</span>
                    <input
                      className={inputClass}
                      placeholder='"Segoe UI", Candara, sans-serif'
                      value={draftSettings.appearance.fontFamily || ""}
                      onChange={(e) => updateDraftAppearance({ fontFamily: e.target.value })}
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span className="text-[10px] uppercase text-[var(--muted)]">Google Fonts CSS URL</span>
                    <input
                      className={inputClass}
                      placeholder="https://fonts.googleapis.com/css2?family=..."
                      value={draftSettings.appearance.fontUrl || ""}
                      onChange={(e) => updateDraftAppearance({ fontUrl: e.target.value })}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <label className="block space-y-1">
                      <span className="text-[10px] uppercase text-[var(--muted)]">Радиус md</span>
                      <input
                        className={inputClass}
                        placeholder="12px"
                        value={draftSettings.appearance.radiusMd || ""}
                        onChange={(e) => updateDraftAppearance({ radiusMd: e.target.value })}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] uppercase text-[var(--muted)]">Радиус lg</span>
                      <input
                        className={inputClass}
                        placeholder="16px"
                        value={draftSettings.appearance.radiusLg || ""}
                        onChange={(e) => updateDraftAppearance({ radiusLg: e.target.value })}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] uppercase text-[var(--muted)]">Отступ карточки</span>
                      <input
                        className={inputClass}
                        placeholder="0.65rem"
                        value={draftSettings.appearance.cardPadding || ""}
                        onChange={(e) => updateDraftAppearance({ cardPadding: e.target.value })}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] uppercase text-[var(--muted)]">Зазор карточки</span>
                      <input
                        className={inputClass}
                        placeholder="0.45rem"
                        value={draftSettings.appearance.cardGap || ""}
                        onChange={(e) => updateDraftAppearance({ cardGap: e.target.value })}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] uppercase text-[var(--muted)]">Размер заголовка карточки</span>
                      <input
                        className={inputClass}
                        placeholder="0.8125rem"
                        value={draftSettings.appearance.cardTitleSize || ""}
                        onChange={(e) => updateDraftAppearance({ cardTitleSize: e.target.value })}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] uppercase text-[var(--muted)]">Высота app bar</span>
                      <input
                        className={inputClass}
                        placeholder="3.5rem"
                        value={draftSettings.appearance.appBarHeight || ""}
                        onChange={(e) => updateDraftAppearance({ appBarHeight: e.target.value })}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] uppercase text-[var(--muted)]">Размер чипов</span>
                      <input
                        className={inputClass}
                        placeholder="0.75rem"
                        value={draftSettings.appearance.chipFontSize || ""}
                        onChange={(e) => updateDraftAppearance({ chipFontSize: e.target.value })}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] uppercase text-[var(--muted)]">Мин. высота кнопок</span>
                      <input
                        className={inputClass}
                        placeholder="2.25rem"
                        value={draftSettings.appearance.btnMinHeight || ""}
                        onChange={(e) => updateDraftAppearance({ btnMinHeight: e.target.value })}
                      />
                    </label>
                  </div>
                  <div
                    className="rounded border border-[var(--border-color)] p-3 space-y-1"
                    style={{
                      background: "var(--bg-card)",
                      borderRadius: "var(--radius-md)",
                      padding: "var(--card-pad)",
                      gap: "var(--card-gap)",
                    }}
                    data-testid="admin-appearance-preview"
                  >
                    <p
                      className="font-semibold"
                      style={{ fontSize: "var(--text-card-title)", color: "var(--text-main)" }}
                    >
                      Превью карточки
                    </p>
                    <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Accent: <span style={{ color: "var(--accent)" }}>Volvo EWD</span>
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">Загрузка…</p>
              )}
            </section>
            <div className="sticky bottom-0 z-10 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)]/95 p-3 shadow-lg backdrop-blur">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-xs text-[var(--text-muted)]">
                  {settingsDirty ? "Настройки изменены, сохраните их вручную." : "Все изменения сохранены."}
                </span>
                <button
                  type="button"
                  disabled={!settingsDirty || !draftSettings}
                  className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={() => {
                    if (!draftSettings) return;
                    saveSettings(draftSettings).catch(() => setNotice("Не удалось сохранить"));
                  }}
                >
                  Сохранить изменения
                </button>
              </div>
            </div>
              </>
            ) : null}

            {activeTab === "edits" ? (
            <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3 text-xs">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Добавить узел / провод</h2>
              <div className="grid grid-cols-2 gap-2">
                <input className={inputClass} placeholder="Код 4/86" value={form.component_code} onChange={(e) => setForm({ ...form, component_code: e.target.value })} />
                <input className={inputClass} placeholder="Название" value={form.name_ru} onChange={(e) => setForm({ ...form, name_ru: e.target.value })} />
              </div>
              <button
                type="button"
                className="w-full rounded border border-[var(--border-color)] py-2"
                onClick={async () => {
                  const r = await fetch("/api/admin/components", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ component_code: form.component_code, name_ru: form.name_ru }),
                  });
                  const d = await r.json();
                  setNotice(r.ok ? `Узел ${d.code} сохранён` : d.error || "Ошибка");
                }}
              >
                Сохранить узел
              </button>
              <div className="grid grid-cols-2 gap-2">
                <input className={inputClass} placeholder="subject 74/411" value={form.subject_code} onChange={(e) => setForm({ ...form, subject_code: e.target.value })} />
                <input className={inputClass} placeholder="Пин" value={form.pin_number} onChange={(e) => setForm({ ...form, pin_number: e.target.value })} />
                <input className={inputClass} placeholder="Откуда" value={form.from_code} onChange={(e) => setForm({ ...form, from_code: e.target.value })} />
                <input className={inputClass} placeholder="Куда" value={form.to_code} onChange={(e) => setForm({ ...form, to_code: e.target.value })} />
                <input className={inputClass} placeholder="Цвет" value={form.wire_color_raw} onChange={(e) => setForm({ ...form, wire_color_raw: e.target.value })} />
                <input className={inputClass} placeholder="Harness…" value={form.harness_left} onChange={(e) => setForm({ ...form, harness_left: e.target.value })} />
              </div>
              <button
                type="button"
                className="w-full rounded bg-emerald-600 text-white py-2"
                onClick={async () => {
                  const r = await fetch("/api/admin/wires", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(form),
                  });
                  const d = await r.json();
                  setNotice(r.ok ? `Провод #${d.id} добавлен` : d.error || "Ошибка");
                  if (r.ok) void loadCorrections();
                }}
              >
                Добавить провод
              </button>
              <button
                type="button"
                className="w-full text-[var(--text-muted)]"
                onClick={async () => {
                  await logoutServer();
                  setNotice("Выход");
                }}
              >
                Выйти
              </button>
            </section>
            ) : null}

            {activeTab === "obd" ? (
              <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                    OBD — тестирование и настройка
                  </h2>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    Временно убрано с публичного сайта — доступно только здесь, пока идёт настройка.
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className={`md-btn text-[11px] px-2.5 py-1.5 ${obdSubTab === "elm" ? "md-btn--filled" : "md-btn--tonal"}`}
                    data-testid="admin-obd-tab-elm"
                    onClick={() => setObdSubTab("elm")}
                  >
                    ELM327
                  </button>
                  <button
                    type="button"
                    className={`md-btn text-[11px] px-2.5 py-1.5 ${obdSubTab === "esp" ? "md-btn--filled" : "md-btn--tonal"}`}
                    data-testid="admin-obd-tab-esp"
                    onClick={() => setObdSubTab("esp")}
                  >
                    ESP шлюз
                  </button>
                </div>
                <div className={obdSubTab === "elm" ? "" : "hidden"} aria-hidden={obdSubTab !== "elm"}>
                  <ObdElmPanel />
                </div>
                <div className={obdSubTab === "esp" ? "" : "hidden"} aria-hidden={obdSubTab !== "esp"}>
                  <ObdAdapterPanel />
                </div>
              </section>
            ) : null}

            {activeTab === "kb" ? (
              <section
                className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3"
                data-testid="admin-kb-collector"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Сборщик статей
                  </h2>
                  <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
                    published {kbCollector?.publishedArticles ?? "…"}/{kbCollector?.config.maxPublishedArticles ?? 400} ·
                    pending {kbCollector?.pendingDrafts ?? "…"}/{kbCollector?.config.maxPendingDrafts ?? 40} · cache{" "}
                    {kbCollector?.cacheMb ?? 0} MB
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Вставьте одну или несколько ссылок (по строке). Можно с префиксом платформы:{" "}
                  <code className="text-[10px]">p2 https://…</code>. Платформа «все» — одна ссылка уйдёт в очередь
                  для p1–spa. Allowlist: Drive2, Swedespeed, Volvo Forums, Volvo Support, IPD, FCP. Затем «Запустить» →
                  правьте черновики ниже → публикация вручную.
                </p>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                  <textarea
                    className="rounded border border-[var(--border-color)] bg-[var(--input-bg)] px-2 py-1.5 text-sm min-h-[4.5rem] font-mono"
                    placeholder={"https://www.drive2.ru/l/123\np2 https://www.drive2.ru/l/456\nspa|https://www.fcpeuro.com/..."}
                    value={kbSeedUrl}
                    onChange={(e) => setKbSeedUrl(e.target.value)}
                    data-testid="admin-kb-seed-url"
                  />
                  <select
                    className="rounded border border-[var(--border-color)] bg-[var(--input-bg)] px-2 py-1.5 text-sm h-fit"
                    value={kbSeedPlatform}
                    onChange={(e) => setKbSeedPlatform(e.target.value)}
                  >
                    {["p1", "p2", "p3", "cma", "spa", "all"].map((p) => (
                      <option key={p} value={p}>
                        {p === "all" ? "все платформы" : p.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded border border-[var(--border-color)] bg-[var(--input-bg)] px-2 py-1.5 text-sm h-fit"
                    value={kbSeedTopic}
                    onChange={(e) => setKbSeedTopic(e.target.value)}
                  >
                    {["parts", "electrical", "links"].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="md-btn md-btn--tonal text-[11px] px-2.5 py-1.5 h-fit"
                    onClick={() => void addKbSeed()}
                    data-testid="admin-kb-seed-add"
                  >
                    + Seed
                  </button>
                </div>
                {kbSeedMsg ? (
                  <p className="text-xs text-amber-800" data-testid="admin-kb-seed-msg">
                    {kbSeedMsg}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="rounded border border-[var(--border-color)] bg-[var(--input-bg)] px-2 py-1.5 text-sm"
                    value={kbCollectMode}
                    onChange={(e) => setKbCollectMode(e.target.value as typeof kbCollectMode)}
                  >
                    <option value="online">online (скачать)</option>
                    <option value="offline">offline (только кэш)</option>
                    <option value="dry-run">dry-run</option>
                  </select>
                  <button
                    type="button"
                    className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    disabled={kbCollectBusy}
                    onClick={() => void runKbCollector()}
                    data-testid="admin-kb-collector-run"
                  >
                    {kbCollectBusy ? "Собираю…" : "Запустить сборщик"}
                  </button>
                  <button
                    type="button"
                    className="md-btn md-btn--tonal text-[11px] px-2.5 py-1.5"
                    onClick={() => void loadKbCollector()}
                  >
                    Обновить статус
                  </button>
                  <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
                    очередь {kbCollector?.urls.queued ?? 0} · done {kbCollector?.urls.done ?? 0} · err{" "}
                    {kbCollector?.urls.error ?? 0}
                  </span>
                </div>
                {kbCollector?.seedsList?.length ? (
                  <ul className="max-h-36 overflow-auto space-y-1 text-[11px] text-[var(--text-muted)]">
                    {kbCollector.seedsList.slice(0, 12).map((s) => (
                      <li key={s.id} className="truncate">
                        <span className="uppercase text-[var(--text-main)]">{s.platform}</span> · {s.status} ·{" "}
                        <a className="underline break-all" href={s.url} target="_blank" rel="noreferrer">
                          {s.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-[var(--text-muted)]">Seeds пока нет — добавьте ссылку выше.</p>
                )}
              </section>
            ) : null}

            {activeTab === "kb" ? (
              <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3" data-testid="admin-kb">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Заявки в базу знаний
                  </h2>
                  <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
                    pending {kbCounts.pending || 0} · approved {kbCounts.approved || 0} · rejected{" "}
                    {kbCounts.rejected || 0}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Пользователи и сборщик кладут сюда черновики. Approve пишет статью в{" "}
                  <code className="text-[10px]">data/knowledge/articles</code>.
                </p>
                <div className="flex flex-wrap gap-1 items-center">
                  {(["pending", "approved", "rejected", "all"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`md-btn text-[11px] px-2.5 py-1.5 ${kbFilter === s ? "md-btn--filled" : "md-btn--tonal"}`}
                      onClick={() => setKbFilter(s)}
                    >
                      {s}
                    </button>
                  ))}
                  {kbFilter === "pending" && kbSelected.length > 0 ? (
                    <button
                      type="button"
                      className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white ml-auto"
                      onClick={() => void batchApproveKb()}
                      data-testid="admin-kb-batch-approve"
                    >
                      Опубликовать выбранные ({kbSelected.length})
                    </button>
                  ) : null}
                </div>
                {kbSubs.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">Нет заявок в этом фильтре.</p>
                ) : (
                  <ul className="space-y-3">
                    {kbSubs.map((s) => (
                      <li
                        key={s.id}
                        className="rounded-lg border border-[var(--border-color)] p-3 space-y-2 text-sm"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <strong className="flex flex-wrap items-center gap-2">
                            {s.status === "pending" ? (
                              <input
                                type="checkbox"
                                checked={kbSelected.includes(s.id)}
                                onChange={(e) => {
                                  setKbSelected((prev) =>
                                    e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id),
                                  );
                                }}
                                aria-label={`Выбрать #${s.id}`}
                              />
                            ) : null}
                            #{s.id} · {s.platform.toUpperCase()} · {s.kind}
                            {s.author_name === "collector" || String(s.admin_note || "").startsWith("collector") ? (
                              <span className="text-[10px] uppercase tracking-wide text-emerald-700">collector</span>
                            ) : null}
                          </strong>
                          <span className="text-[10px] text-[var(--text-muted)] tabular-nums">{s.created_at}</span>
                        </div>
                        <div className="font-medium">{s.title}</div>
                        {s.summary ? <p className="text-xs text-[var(--text-muted)]">{s.summary}</p> : null}
                        {s.source_url ? (
                          <a
                            className="text-xs text-emerald-700 underline break-all"
                            href={s.source_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {s.source_url}
                          </a>
                        ) : null}
                        {s.body_md ? (
                          <pre className="text-[11px] whitespace-pre-wrap max-h-40 overflow-auto bg-[var(--input-bg)] rounded p-2 border border-[var(--border-color)]">
                            {s.body_md}
                          </pre>
                        ) : null}
                        {s.published_slug ? (
                          <p className="text-[11px] text-[var(--text-muted)]">
                            slug: <code>{s.published_slug}</code>
                          </p>
                        ) : null}
                        {s.status === "pending" ? (
                          <div className="flex flex-wrap gap-2 pt-1">
                            <button
                              type="button"
                              disabled={kbBusyId === s.id}
                              className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                              onClick={() => void moderateKb(s.id, "approve")}
                            >
                              Approve → опубликовать
                            </button>
                            <button
                              type="button"
                              disabled={kbBusyId === s.id}
                              className="rounded border border-[var(--border-color)] px-3 py-1.5 text-xs disabled:opacity-50"
                              onClick={() => void moderateKb(s.id, "reject")}
                            >
                              Отклонить
                            </button>
                          </div>
                        ) : (
                          <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{s.status}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            {activeTab === "kb" ? (
              <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3" data-testid="admin-kb-comments">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Комментарии к статьям
                  </h2>
                  <button
                    type="button"
                    className="md-btn md-btn--tonal text-[11px] px-2.5 py-1.5"
                    onClick={() => void loadKbComments()}
                  >
                    Обновить
                  </button>
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Без очереди: комментарий сразу публичный. Здесь только удаление спама. Глобальный вкл/выкл — в
                  Настройках («Комментарии в базе знаний»).
                </p>
                {kbComments.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">Пока нет комментариев.</p>
                ) : (
                  <ul className="space-y-2">
                    {kbComments.map((c) => (
                      <li
                        key={c.id}
                        className="rounded-lg border border-[var(--border-color)] p-3 space-y-1.5 text-sm"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <strong>
                            #{c.id} · <code className="text-[11px]">{c.article_slug}</code>
                          </strong>
                          <span className="text-[10px] text-[var(--text-muted)] tabular-nums">{c.created_at}</span>
                        </div>
                        <div className="text-xs text-[var(--text-muted)]">
                          {c.author_name?.trim() ? c.author_name : "Аноним"}
                        </div>
                        <p className="text-xs whitespace-pre-wrap">{c.body}</p>
                        <button
                          type="button"
                          disabled={kbCommentBusyId === c.id}
                          className="rounded border border-[var(--border-color)] px-3 py-1.5 text-xs disabled:opacity-50"
                          onClick={() => void deleteKbComment(c.id)}
                        >
                          Удалить
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}
          </>
        )}

        {!admin && notice ? <p className="text-sm text-amber-700">{notice}</p> : null}
      </div>
    </main>
  );
}
