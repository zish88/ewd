import { useEffect, useRef, useState } from "react";

type Features = {
  suggestions: boolean;
  ewdDiagrams: boolean;
  vinSearch: boolean;
  navBrowse: boolean;
  dtcSearch: boolean;
};

type Settings = {
  siteOpen: boolean;
  features: Features;
  updatedAt?: string;
};

type VisitStats = {
  today: number;
  yesterday: number;
  week: number;
  month: number;
  total: number;
  online30m: number;
  recent: Array<{ id: number; visitedAt: string; path: string }>;
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
};

const ADMIN_UI_SESSION_KEY = "ewd_admin_ui";

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
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [visits, setVisits] = useState<VisitStats | null>(null);
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
    const d = await r.json();
    setSettings(d as Settings);
  }

  async function loadVisits() {
    const r = await fetch("/api/admin/visits", { credentials: "include" });
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
    setAdmin(false);
    setSettings(null);
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
    setSettings(d as Settings);
    setNotice("Настройки сохранены");
  }

  const inputClass = "rounded border border-[var(--border-color)] bg-[var(--input-bg)] px-2 py-1.5 w-full";

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

              <div className="rounded-lg border border-[var(--border-color)] p-3 space-y-1 text-[var(--text-muted)]">
                <div>
                  Правок за сутки (оверлей): <strong className="text-[var(--text-main)]">{syncInfo?.today ?? "—"}</strong>
                </div>
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
            </section>

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
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Онлайн — уникальные сессии за последние 30 мин. Сегодня/вчера — календарные сутки UTC.
                  </p>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)] pt-1">Когда заходили</h3>
                  {visits.recent.length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)]">Пока нет записей.</p>
                  ) : (
                    <ul className="max-h-40 md:max-h-64 overflow-y-auto divide-y divide-[var(--border-color)] text-sm">
                      {visits.recent.map((v) => (
                        <li key={v.id} className="flex items-baseline justify-between gap-3 py-1.5">
                          <span className="tabular-nums text-[var(--text-main)]">{formatVisitAt(v.visitedAt)}</span>
                          <span className="truncate text-[var(--text-muted)] font-mono text-xs">{v.path || "/"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">Загрузка…</p>
              )}
            </section>

            <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Доступность сайта</h2>
              {settings ? (
                <>
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>Сайт открыт для посетителей</span>
                    <input
                      type="checkbox"
                      checked={settings.siteOpen}
                      onChange={(e) => {
                        const next = { ...settings, siteOpen: e.target.checked };
                        setSettings(next);
                        void saveSettings(next);
                      }}
                    />
                  </label>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)] pt-2">Функции</h3>
                  <ul className="space-y-2">
                    {(Object.keys(FEATURE_LABELS) as Array<keyof Features>).map((key) => (
                      <label key={key} className="flex items-center justify-between gap-3 text-sm">
                        <span>{FEATURE_LABELS[key]}</span>
                        <input
                          type="checkbox"
                          checked={settings.features[key]}
                          onChange={(e) => {
                            const next = {
                              ...settings,
                              features: { ...settings.features, [key]: e.target.checked },
                            };
                            setSettings(next);
                            void saveSettings(next);
                          }}
                        />
                      </label>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">Загрузка настроек…</p>
              )}
            </section>

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
          </>
        )}

        {notice ? <p className="text-sm text-amber-700">{notice}</p> : null}
      </div>
    </main>
  );
}
