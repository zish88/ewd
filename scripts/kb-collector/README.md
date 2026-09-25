# KB collector

Админ → вкладка **База знаний** → блок «Сборщик статей».

1. Добавить URL (allowlist в `config.defaults.json`)
2. Режим `online` / `offline` / `dry-run` → **Запустить сборщик**
3. Черновики в заявках ниже → checkbox → **Опубликовать выбранные**

Квоты: см. `config.defaults.json`. State/cache gitignore: `data/knowledge-collector*`.

Smoke offline: `npx tsx scripts/kb-collector/_smoke.mjs`
