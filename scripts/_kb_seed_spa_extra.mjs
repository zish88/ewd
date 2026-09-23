/**
 * Extra SPA articles (NOT cabin filter / spark plugs focus).
 * Usage: node scripts/_kb_seed_spa_extra.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "data/knowledge";
const ART = path.join(ROOT, "articles");
const IDX = path.join(ROOT, "index.json");

function normUrl(u) {
  return String(u || "")
    .trim()
    .replace(/\/$/, "")
    .toLowerCase();
}

function loadExistingUrls() {
  const urls = new Set();
  for (const f of fs.readdirSync(ART).filter((x) => x.endsWith(".json"))) {
    const a = JSON.parse(fs.readFileSync(path.join(ART, f), "utf8"));
    for (const l of a.links || []) if (l.url) urls.add(normUrl(l.url));
    if (a.author?.post_url) urls.add(normUrl(a.author.post_url));
  }
  return urls;
}

/** @type {Array<{slug:string,platform:string,topics:string[],title:string,summary:string,body:string,url:string}>} */
const SEED = [
  {
    slug: "spa-xc90-t8-brakes-atf-haldex",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC90: тормоза размера T8 + ATF и Haldex",
    summary:
      "На XC90 II ставят увеличенные диски как у T8 (19″/18″ вместо 18″/17″). Вместе часто меняют ATF (~8 л замещением) и разбирают Haldex — сетка насоса.",
    body: "## Суть\n\nТормоза «от T8» + трансмиссионное ТО на **XC90 II**.\n\n## Практика\n\n- Диски крупнее штатных T5/D5 — сверяйте скобы/суппорт.\n- АКПП: два слива, ориентир **~8 л** на ~60 ткм.\n- Haldex: масло светлое, но в картере бывает гудрон — чистят сетку.\n\n## Важно\n\nУгловые передачи часто откладывают на следующее трансмиссионное ТО (~100 ткм).",
    url: "https://www.drive2.ru/l/641858055729844678/",
  },
  {
    slug: "spa-xc60-fluids-brakes-52k",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC60 II: жидкости AWD + тормоза на 52 ткм",
    summary:
      "Пакет: ATF ZIC 162665, Haldex Ravenol, угловая/редуктор Mannol + кольцо 11998, ТЖ; перед Gparts VO31665446 / Brembo P86028, зад Zekkert / P86030.",
    body: "## Суть\n\nЖидкости полного привода и тормоза по кругу на **XC60 II**.\n\n## PN (из БЖ)\n\n- ATF: ZIC **162665**\n- Haldex: Ravenol **1211140001**\n- Угловая/редуктор: Mannol **1304** + кольцо Volvo **11998**\n- Перед: диск Gparts **VO31665446**, колодки Brembo **P86028**\n- Зад: Zekkert **BS-6596**, Brembo **P86030**\n\n## Важно\n\nРазмер дисков 17″/16″ — не универсален. VIN!",
    url: "https://www.drive2.ru/l/659347162559164615/",
  },
  {
    slug: "spa-s90-wipers-oem-32341610",
    platform: "spa",
    topics: ["parts"],
    title: "SPA S90: дворники OEM 32341610 (ex 32282838)",
    summary:
      "Оригинал для S90: 32341610 (старый 32282838). Те же щётки на V90 с 2016 и XC90 с 2015. Сервисный режим — отдельный пункт в меню SPA.",
    body: "## Суть\n\nЗамена щёток на **S90 II** проще, чем на P3: сервисный режим в меню.\n\n## PN\n\n- Текущий: **32341610**\n- Старый: **32282838**\n\n## Важно\n\nКроссы на XC90/V90 — проверяйте длину и крепление.",
    url: "https://www.drive2.ru/l/699310287060228500/",
  },
  {
    slug: "spa-xc90-battery-exide-95",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC90: подбор основной АКБ — размер vs VIN",
    summary:
      "Webasto «садит» основную батарею. По VIN иногда стоит батарея «как у XC60»; площадка 95 А·ч может подойти, а фиксатор — нет (крепят ремнём).",
    body: "## Суть\n\nЗамена основной АКБ на **XC90 II**.\n\n## Практика\n\nСверяйте **VIN**, не только модель. Exide/оригинал — по размеру площадки и полюсам.\n\n## Важно\n\nФиксатор и высота крышки должны совпасть; иначе временный ремень — не норма.",
    url: "https://www.drive2.ru/l/717890659180104210/",
  },
  {
    slug: "spa-v90-main-battery-delta",
    platform: "spa",
    topics: ["parts"],
    title: "SPA V90 CC: основная АКБ и отказ Webasto",
    summary:
      "Мотор крутит, Webasto при −4 °C пишет низкий заряд. Меняют основную АКБ (ориентир OEM 31419211 / аналоги того же форм-фактора); не забыть заглушку вентиляции.",
    body: "## Суть\n\nWebasto отказывается при ещё «живом» старте — типичный сигнал по основной АКБ на **V90 CC**.\n\n## PN\n\n- OEM ориентир: **31419211**\n- Форма/полюса — как у оригинала\n\n## Важно\n\nПоставьте заглушку/трубку вентиляции газов.",
    url: "https://www.drive2.ru/l/691456475503018186/",
  },
  {
    slug: "spa-xc90-agm-banner-92",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC90: AGM Banner 92 А·ч под Webasto",
    summary:
      "Штатные 80 А·ч AGM заводят мотор в −25, но Webasto падает по заряду. Ставят более ёмкий AGM (пример Banner 92 А·ч) + зарядное; после — наблюдение за работой предпускового.",
    body: "## Суть\n\nЁмкость основной АКБ критична для **Webasto** на **XC90 II**.\n\n## Практика\n\nСначала полный заряд качественным ЗУ; если Webasto всё равно отваливается — апгрейд ёмкости AGM в тот же размер.\n\n## Важно\n\nПосле замены желательна регистрация/сброс BMS через диагностику.",
    url: "https://www.drive2.ru/l/581729887975374876/",
  },
  {
    slug: "spa-xc90-brake-fluid-atf-partial",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC90: ТЖ Bosch ENV6 + частичная ATF",
    summary:
      "Промежуточное ТО: тормозная Bosch ENV6 (1 987 479 207), частичный слив ATF (~2,5 л оказалось чистым). Масляный Hengst E217H D310.",
    body: "## Суть\n\nТЖ по сроку (~2 года) и контроль ATF на **XC90 II**.\n\n## PN\n\n- ТЖ: Bosch **ENV6** 1 987 479 207\n- Масляный: Hengst **E217H D310**\n\n## Важно\n\nПлотность ТЖ можно измерить, но многие меняют по календарю.",
    url: "https://www.drive2.ru/l/657665734402379142/",
  },
  {
    slug: "spa-xc90-diesel-fuel-filter-febi",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC90 D5: топливный фильтр 32312226 / Febi 174039",
    summary:
      "На дизельном XC90 II топливный OEM 32312226; кроссы Febi 174039, Blue Print ADBP230026, Vaico V95-0583. Воздух/масло — Filtron или MANN по наличию.",
    body: "## Суть\n\nТопливный фильтр дизельного **SPA XC90**.\n\n## PN\n\n- OEM **32312226**\n- Febi **174039** / Blue Print **ADBP230026** / Vaico **V95-0583**\n\n## Важно\n\nБензиновый SPA — другие артикулы (не путать).",
    url: "https://www.drive2.ru/l/615721015070172728/",
  },
  {
    slug: "spa-xc90-front-lca",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC90: нижние передние рычаги",
    summary:
      "На XC90 II меняют нижние передние рычаги в сборе (оригинал дорого; встречаются корейские/китайские). После — сход-развал. Шаровые дефектуют до установки.",
    body: "## Суть\n\nПередние нижние рычаги на **XC90 II**.\n\n## Практика\n\nПеред установкой проверьте шаровую: стопорное кольцо, смазка, ход пальца. Оригинал (Норвегия/Китай) и aftermarket отличаются по завальцовке.\n\n## Важно\n\nОбязателен сход-развал.",
    url: "https://www.drive2.ru/l/714476125820031208/",
  },
  {
    slug: "spa-xc60-angle-gear-oil",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC60 II: масло угловой и заднего редуктора 31259380",
    summary:
      "На ТО-7 вместе с моторным меняют угловую и задний редуктор — OEM 31259380. Литра часто мало (~100 мл не хватает) из‑за глубокой откачки воздухом; для доступа снимают патрубок.",
    body: "## Суть\n\nМасла AWD-редукторов на **XC60 II**.\n\n## PN\n\n- Volvo **31259380** (берите с запасом >1 л)\n- Масляный ДВС рядом: **32140029** + **977751**\n\n## Практика\n\nДля угловой снимают воздушный патрубок; хомут часто ржавый — меняют.\n\n## Важно\n\nОбъём зависит от метода откачки (воздух vs шприц).",
    url: "https://www.drive2.ru/l/732003440678411732/",
  },
  {
    slug: "spa-haldex-angle-brake-fluid",
    platform: "spa",
    topics: ["parts"],
    title: "SPA: Haldex 31367940 + угловая/редуктор + ТЖ",
    summary:
      "Профилактика AWD: масло угловой и редуктора, Haldex 31367940 с чисткой сетки насоса и прокачкой Launch; пробка поддона 31325479; ремкомплект насоса 31325413.",
    body: "## Суть\n\nПолный привод SPA: Haldex + редукторы + ТЖ.\n\n## PN\n\n- Haldex: **31367940**\n- Пробка поддона: **31325479**\n- Ремкомплект насоса: **31325413** (VAG-кросс ищут как дешёвый аналог — на свой риск)\n\n## Практика\n\nСетка насоса, ~0,5 л + долив после прокачки. Уплотнительное кольцо пробки угловой — по состоянию.\n\n## Важно\n\nНе лей ATF/75W-90 в Haldex.",
    url: "https://www.drive2.ru/l/651268500874071296/",
  },
  {
    slug: "spa-s90-aux-battery-ytx12",
    platform: "spa",
    topics: ["parts"],
    title: "SPA S90: вспомогательный АКБ Start/Stop YTX12-BS",
    summary:
      "Малый АКБ у стакана стойки: стандарт YTX12-BS (152×88×131). Аналоги Bosch M6 014, Varta 510012009, Yuasa YTX12-BS. Ошибка Start/Stop часто = мёртвая «мото»-батарея.",
    body: "## Суть\n\nВспомогательный АКБ Start/Stop на **S90**.\n\n## PN / размер\n\n- Форм-фактор **YTX12-BS**\n- Bosch **M6 014**, Varta **510012009**, Yuasa **YTX12-BS**\n\n## Важно\n\nСообщение на приборке после замены может не уйти сразу — см. процедуру обесточивания.",
    url: "https://www.drive2.ru/l/631315663364840297/",
  },
  {
    slug: "spa-xc90-aux-battery-bosch",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC90: вспомогательный АКБ — Bosch M6 019",
    summary:
      "Ошибка по АКБ Start/Stop на XC90 II: меняют малый аккумулятор; мото-аналог в разы дешевле. Пример: Bosch M6 019 сухозаряженный.",
    body: "## Суть\n\nВспомогательный АКБ на **XC90 II**.\n\n## Практика\n\nОшибка не всегда влияет на езду, но Start/Stop и сообщения на приборке — да. Ставят AGM мото-формата.\n\n## Важно\n\nКлеммы неоригинала часто отличаются — готовьте крепёж.",
    url: "https://www.drive2.ru/l/579989086190698532/",
  },
  {
    slug: "spa-xc60-aux-battery-reset",
    platform: "spa",
    topics: ["electrical"],
    title: "SPA XC60: сброс ошибки после замены AUX АКБ",
    summary:
      "CEM-B10A613 / «Пуск/Стоп требуется сервис»: мало заменить батарею. Отключить AUX → минус основной → фишку S на BCSM → ждать ≥15 мин → собрать в обратном порядке → стереть DTC CEM.",
    body: "## Суть\n\nПроцедура после замены вспомогательного АКБ на **XC60 II**.\n\n## Чеклист\n\n1. Снять AUX (крышка, клеммы).\n2. Минус основного АКБ.\n3. Фишка **S** на блоке **BCSM**.\n4. Ждать **≥15 минут** (новый AUX уже на месте, клеммы ещё нет).\n5. Фишка S → клеммы AUX → минус основной.\n6. Активный режим → стереть ошибки CEM сканером.\n\n## Важно\n\nБез паузы и фишки S сообщение на приборке часто остаётся.",
    url: "https://www.drive2.ru/l/687663160387181159/",
  },
  {
    slug: "spa-xc90-aux-battery-diy",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC90: замена вспомогательного АКБ своими руками",
    summary:
      "Крышка у стакана → минус, затем плюс → вынуть. Сборка наоборот. Неоригинал тоньше/легче при той же Ah — клеммные болты часто короткие.",
    body: "## Суть\n\nDIY-замена малого АКБ на **XC90 II**.\n\n## Практика\n\nПоследовательность клемм важна. АКБ в коробе часто ничем не прижат — следите, чтобы не болтался.\n\n## Важно\n\nЕсли ошибка не уходит — полный цикл с основным АКБ и BCSM (см. соседнюю заметку XC60).",
    url: "https://www.drive2.ru/l/619833463435991189/",
  },
  {
    slug: "spa-aux-battery-error-order",
    platform: "spa",
    topics: ["electrical"],
    title: "SPA: ошибка зарядки 12В — порядок AUX и основной АКБ",
    summary:
      "DTC B10A613 / «АКБ 12В крит.»: малый АКБ мёртв. После замены: сначала отключить малый, потом основной в багажнике; подключать в том же порядке малый → большой.",
    body: "## Суть\n\nПорядок подключения батарей на **SPA** после замены AUX.\n\n## Практика\n\nЕсли просто воткнуть новый малый АКБ — сообщение на приборке часто остаётся. Нужен цикл с основным АКБ.\n\n## Важно\n\nПроверяйте напряжение малого АКБ тестером — «оборудование не включается» = полный отказ.",
    url: "https://www.drive2.ru/l/709375766256684366/",
  },
  {
    slug: "spa-xc60-brake-fluid-interval",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC60 II: тормозная жидкость 32214958 по сроку",
    summary:
      "Регламент Volvo — ТЖ примерно раз в 3 года (арт. 32214958), независимо от малого пробега. На ТО-6 часто совмещают с топливным 32242191 и моторным маслом.",
    body: "## Суть\n\nТормозная жидкость на **XC60 II** — календарный расходник.\n\n## PN\n\n- ТЖ Volvo **32214958** (~0,8 л)\n- Топливный (если по сроку): **32242191**\n\n## Важно\n\nМалый годовой пробег не отменяет замену ТЖ по годам.",
    url: "https://www.drive2.ru/l/704196241856139035/",
  },
];

function main() {
  const existing = loadExistingUrls();
  const used = new Set(existing);
  const slugs = new Set(
    fs
      .readdirSync(ART)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, "")),
  );

  let written = 0;
  const writtenSlugs = [];
  let skippedUrl = 0;
  let skippedSlug = 0;

  for (const item of SEED) {
    if (slugs.has(item.slug)) {
      skippedSlug++;
      continue;
    }
    const primary = normUrl(item.url);
    if (used.has(primary)) {
      skippedUrl++;
      continue;
    }
    used.add(primary);

    const article = {
      slug: item.slug,
      title: item.title,
      platform: item.platform,
      topics: item.topics,
      summary: item.summary,
      updated: "2026-09-23",
      body_md: item.body,
      links: [{ title: item.title + " — Drive2", url: item.url, site: "Drive2" }],
      author: { post_url: item.url },
    };
    fs.writeFileSync(path.join(ART, `${item.slug}.json`), JSON.stringify(article, null, 2) + "\n");
    slugs.add(item.slug);
    writtenSlugs.push(item.slug);
    written++;
  }

  const idx = JSON.parse(fs.readFileSync(IDX, "utf8"));
  const bySlug = new Map(idx.articles.map((a) => [a.slug, a]));
  for (const f of fs.readdirSync(ART).filter((x) => x.endsWith(".json"))) {
    const a = JSON.parse(fs.readFileSync(path.join(ART, f), "utf8"));
    bySlug.set(a.slug, {
      slug: a.slug,
      title: a.title,
      platform: a.platform,
      topics: a.topics || ["parts"],
      summary: a.summary || "",
      updated: a.updated || "2026-09-23",
      ...(a.component_code ? { component_code: a.component_code } : {}),
    });
  }
  idx.articles = [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  fs.writeFileSync(IDX, JSON.stringify(idx, null, 2) + "\n");

  const by = {};
  for (const a of idx.articles) by[a.platform] = (by[a.platform] || 0) + 1;

  const owners = new Map();
  let dups = 0;
  for (const f of fs.readdirSync(ART).filter((x) => x.endsWith(".json"))) {
    const a = JSON.parse(fs.readFileSync(path.join(ART, f), "utf8"));
    for (const u of [...(a.links || []).map((l) => l.url), a.author?.post_url]
      .filter(Boolean)
      .map(normUrl)
      .filter((u) => /drive2\.ru/.test(u))) {
      const prev = owners.get(u);
      if (prev && prev !== a.slug) {
        console.log("DUP", u, prev, a.slug);
        dups++;
      } else owners.set(u, a.slug);
    }
  }

  console.log(
    JSON.stringify(
      { written, skippedUrl, skippedSlug, totalArticles: idx.articles.length, byPlatform: by, dups, writtenSlugs },
      null,
      2,
    ),
  );
}

main();
