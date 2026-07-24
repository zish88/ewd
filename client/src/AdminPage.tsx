import { useEffect, useState } from "react";

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

const FEATURE_LABELS: Record<keyof Features, string> = {
  suggestions: "Предложения правок с карточек (почта)",
  ewdDiagrams: "Графические схемы EWD",
  vinSearch: "Поиск по VIN",
  navBrowse: "Навигация по зонам и узлам",
  dtcSearch: "Поиск DTC / OBD кодов",
};

export function AdminPage() {
  const [configured, setConfigured] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
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

  useEffect(() => {
    void (async () => {
      const ok = await refreshMe();
      if (ok) await loadSettings();
    })();
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
    setPassword("");
    setAdmin(true);
    setNotice("Вход выполнен");
    await loadSettings();
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

  return (
    <main className="min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] px-4 py-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-[var(--accent)]">Админ · Volvo EWD</h1>
          <a href="/" className="text-xs underline text-[var(--text-muted)]">
            ← На сайт
          </a>
        </div>

        {!admin ? (
          <form onSubmit={login} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3">
            <p className="text-sm text-[var(--text-muted)]">
              {configured
                ? "Войдите паролем ADMIN_PASSWORD, чтобы управлять доступом к сайту."
                : "ADMIN_PASSWORD не задан — задайте его в окружении контейнера."}
            </p>
            <input
              type="password"
              className="w-full rounded border border-[var(--border-color)] bg-[var(--input-bg)] px-3 py-2 text-sm"
              placeholder="Пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!configured}
            />
            <button type="submit" className="w-full rounded bg-emerald-600 text-white py-2 text-sm font-medium" disabled={!configured}>
              Войти
            </button>
          </form>
        ) : (
          <>
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
                  <p className="text-xs text-[var(--text-muted)]">
                    Если выключить — на главной будет экран «сайт временно недоступен» (админка останется).
                  </p>
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
                  {settings.updatedAt ? (
                    <p className="text-[10px] text-[var(--text-muted)]">Обновлено: {settings.updatedAt}</p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">Загрузка настроек…</p>
              )}
            </section>

            <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3 text-xs">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Данные · узлы и провода</h2>
              <div className="grid grid-cols-2 gap-2">
                <input className="rounded border border-[var(--border-color)] bg-[var(--input-bg)] px-2 py-1.5" placeholder="Код 4/86" value={form.component_code} onChange={(e) => setForm({ ...form, component_code: e.target.value })} />
                <input className="rounded border border-[var(--border-color)] bg-[var(--input-bg)] px-2 py-1.5" placeholder="Название" value={form.name_ru} onChange={(e) => setForm({ ...form, name_ru: e.target.value })} />
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
                <input className="rounded border border-[var(--border-color)] bg-[var(--input-bg)] px-2 py-1.5" placeholder="subject 74/411" value={form.subject_code} onChange={(e) => setForm({ ...form, subject_code: e.target.value })} />
                <input className="rounded border border-[var(--border-color)] bg-[var(--input-bg)] px-2 py-1.5" placeholder="Пин" value={form.pin_number} onChange={(e) => setForm({ ...form, pin_number: e.target.value })} />
                <input className="rounded border border-[var(--border-color)] bg-[var(--input-bg)] px-2 py-1.5" placeholder="Откуда" value={form.from_code} onChange={(e) => setForm({ ...form, from_code: e.target.value })} />
                <input className="rounded border border-[var(--border-color)] bg-[var(--input-bg)] px-2 py-1.5" placeholder="Куда" value={form.to_code} onChange={(e) => setForm({ ...form, to_code: e.target.value })} />
                <input className="rounded border border-[var(--border-color)] bg-[var(--input-bg)] px-2 py-1.5" placeholder="Цвет" value={form.wire_color_raw} onChange={(e) => setForm({ ...form, wire_color_raw: e.target.value })} />
                <input className="rounded border border-[var(--border-color)] bg-[var(--input-bg)] px-2 py-1.5" placeholder="Harness…" value={form.harness_left} onChange={(e) => setForm({ ...form, harness_left: e.target.value })} />
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
                }}
              >
                Добавить провод
              </button>
              <button
                type="button"
                className="w-full text-[var(--text-muted)]"
                onClick={async () => {
                  await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
                  setAdmin(false);
                  setSettings(null);
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
