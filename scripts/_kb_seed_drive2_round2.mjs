/**
 * Seed ~15 curated KB articles from open Drive2 posts (unique URLs only).
 * Usage: node scripts/_kb_seed_drive2_round2.mjs && node scripts/_kb_sync_index.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "data/knowledge";
const ART = path.join(ROOT, "articles");

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
  // ——— CMA ———
  {
    slug: "cma-xc40-main-battery-exide-ek720",
    platform: "cma",
    topics: ["parts", "electrical"],
    title: "CMA XC40: основной АКБ Exide EK720",
    summary:
      "На бензиновом XC40 ~4 года службы — типичный повод менять основной АКБ; в БЖ брали Exide EK720, подбор строго по размеру/ёмкости.",
    body: "## Суть\n\nНа **XC40 (CMA)** основной АКБ часто меняют профилактически к 4–5 году.\n\n## Практика\n\nВ посте — **Exide EK720** из специализированного магазина; перед покупкой замер нагрузочной вилкой.\n\n## Важно\n\nПосле замены на CMA/SPA часто нужен **сброс BMS**. Сверяйте PN по VIN. Выжимка Drive2.",
    url: "https://www.drive2.ru/l/713767765453841906/",
  },
  {
    slug: "cma-xc40-vtool-pin-key",
    platform: "cma",
    topics: ["electrical", "links"],
    title: "CMA XC40: VTool — пин ключа и сервисные функции",
    summary:
      "Владельцы XC40 используют VTool для чтения PIN ключа, сервисных сбросов и калибровок (AWD/климат), когда Orbit не справляется.",
    body: "## Суть\n\nНа **XC40** диагностика через **VTool**: PIN второго ключа, адаптации, калибровки.\n\n## Практика\n\nАвтор отмечает быстрый подбор PIN при известном PIN CEM; сервисный режим бесплатный.\n\n## Важно\n\nНе инструкция по взлому — только опыт владельца. Выжимка Drive2.",
    url: "https://www.drive2.ru/l/686584264602419987/",
  },

  // ——— P3 ———
  {
    slug: "p3-s60ii-thermostat-heater-circuit",
    platform: "p3",
    topics: ["parts", "electrical"],
    title: "P3 S60 II: ошибка нагревателя термостата ECM-P0597",
    summary:
      "На S60 II бензин встречается код обрыва цепи нагревателя термостата; ставят OEM 31686560 или б/у 31474989 + адаптация.",
    body: "## Суть\n\n**ECM-P059700** — обрыв цепи управления нагревателем электронного термостата на **S60 II**.\n\n## Партномера\n\n- Новый OEM ориентир: **31686560** (дорого)\n- В БЖ ставили б/у **31474989**\n- Прокладка термостата: **31368063**\n\n## Важно\n\nПосле замены часто нужна программная адаптация. VIN обязателен. Выжимка Drive2.",
    url: "https://www.drive2.ru/l/633837668161033504/",
  },
  {
    slug: "p3-xc70-battery-bms-reset-vida",
    platform: "p3",
    topics: ["electrical"],
    title: "P3 XC70 III: замена АКБ и сброс BMS в CEM",
    summary:
      "После замены АКБ на XC70 III сбрасывают BMS через VIDA (CEM → Advanced); машину оставляют закрытой 5–6 часов без запуска.",
    body: "## Суть\n\nНа **P3** с BMS генератор учится под конкретную батарею. Без сброса — недозаряд/ошибки.\n\n## Практика\n\n- Зарядка: минус ЗУ на **шасси**, не на клемму АКБ\n- VIDA: **CEM → Advanced → Battery Monitoring Sensor → reset**\n- После сброса не заводить ~5–6 часов\n\n## Важно\n\nВыжимка Drive2, не замена дилерской инструкции.",
    url: "https://www.drive2.ru/l/520224032151306392/",
  },
  {
    slug: "p3-s80-battery-topla-bms",
    platform: "p3",
    topics: ["parts", "electrical"],
    title: "P3 S80 II: АКБ Topla 100 Ач и обнуление BMS",
    summary:
      "На S80 II после установки нового АКБ (пример Topla 100 Ач) стирают ошибки и обнуляют счётчик BMS, затем дают машине «отлежаться».",
    body: "## Суть\n\nЗамена основного АКБ на **S80 II** + обязательный **сброс BMS**.\n\n## Практика\n\nАвтор ставил Topla Energy ~100 Ач / 800 А; после установки — сброс ошибок и BMS.\n\n## Важно\n\nПараметры АКБ должны совпадать с прошитыми в CEM. Выжимка Drive2.",
    url: "https://www.drive2.ru/l/734559255457172503/",
  },
  {
    slug: "p3-s60-p2-timing-thermostat-gates",
    platform: "p2",
    topics: ["parts"],
    title: "P2 S60: ГРМ + термостат Gates TH35991",
    summary:
      "На S60 I при замене ГРМ часто вскрывают течи: сальник распредвала и термостат; в БЖ ставили Gates TH35991.",
    body: "## Суть\n\nКомплекс на **S60 I**: ремень ГРМ/помпа + устранение течей.\n\n## Партномера\n\n- Термостат Gates **TH35991** (пример из БЖ)\n\n## Важно\n\nПлатформа P2 (не путать с S60 II / P3). VIN. Выжимка Drive2.",
    url: "https://www.drive2.ru/l/601719559124184013/",
  },

  // ——— SPA ———
  {
    slug: "spa-xc60ii-timing-atf-haldex",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC60 II: ГРМ + ATF + жидкость Haldex",
    summary:
      "На XC60 II дизель 2018 в одном визите меняют комплект ГРМ/приводной ремень, полную ATF и жидкость Haldex (OEM ориентиры в посте).",
    body: "## Суть\n\nБольшое ТО на **XC60 II (SPA)**: ГРМ + коробка + Haldex.\n\n## Партномера (примеры из БЖ)\n\n- Комплект ремня ГРМ: **32298420**\n- Жидкость Haldex: **31209623** / **31367940**\n\n## Важно\n\nСверяйте по VIN/EPC. После Haldex часто нужна программная прокачка. Выжимка Drive2.",
    url: "https://www.drive2.ru/l/699371309955551715/",
  },
  {
    slug: "spa-s90-aux-battery-haldex-wipers",
    platform: "spa",
    topics: ["parts"],
    title: "SPA S90: доп. АКБ 32238082 + Haldex + щётки",
    summary:
      "На S90 II по рекомендации дилера меняют малый АКБ старт-стоп 32238082, жидкость Haldex 31367940 и щётки 32282838.",
    body: "## Суть\n\nСервисный пакет на **S90 II**: вспомогательный АКБ + Haldex + дворники.\n\n## Партномера\n\n- Доп. АКБ: **32238082**\n- Haldex: **31367940**\n- Щётки: **32282838**\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/718301051895162360/",
  },
  {
    slug: "spa-xc90-to4-atf-coolant-haldex",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC90 II: ТО-4 — ATF, ОЖ, Haldex, фильтры",
    summary:
      "На XC90 II бензин на ТО-4 меняют ATF, антифриз, Haldex и фильтры (Mann + топливный Mahle KL1055) плюс колодки.",
    body: "## Суть\n\nКомплексное ТО **XC90 II**: двигатель, АКПП, ОЖ, Haldex, фильтры, колодки.\n\n## Фильтры (пример)\n\n- Салон: Mann **CUK 34003**\n- Масло: Mann **HU 8014 Z**\n- Воздух: Mann **C 29021**\n- Топливо: Mahle **KL 1055**\n\n## Важно\n\nVIN. Выжимка Drive2.",
    url: "https://www.drive2.ru/l/649594494420795353/",
  },
  {
    slug: "spa-v90-bms-reset-vtool",
    platform: "spa",
    topics: ["electrical"],
    title: "SPA V90: сброс BMS после замены основного АКБ",
    summary:
      "На V90/CC после нового АКБ сбрасывают BMS (VTool / Launch); параметры АКБ должны совпадать с прошитыми в CEM.",
    body: "## Суть\n\nПравильная замена основного АКБ на **SPA** без сброса BMS даёт неверный алгоритм зарядки.\n\n## Практика\n\n- VTool: Service → Misc → **Reset BMS**\n- Параметры V/A/Ah аналога = оригинал\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/720755711604180305/",
  },

  // ——— P2 ———
  {
    slug: "p2-xc70-alternator-overrun-pulley-ina",
    platform: "p2",
    topics: ["parts"],
    title: "P2 XC70: обгонная муфта генератора INA 535007210",
    summary:
      "Шелест/свист с холодной часто даёт заклинившая обгонная муфта генератора; популярный кросс — INA 535007210.",
    body: "## Суть\n\nНа **XC70 II / V70 II** типичная болячка — обгонная муфта (шкив) генератора.\n\n## Партномера\n\n- INA **535007210**\n\n## Практика\n\nЗаклинившая муфта не крутится «в одну сторону»; попутно меняют ремень/ролики и жидкость ГУР.\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/567068725052702946/",
  },
  {
    slug: "p2-xc70-alternator-rebuild-bearings",
    platform: "p2",
    topics: ["parts"],
    title: "P2 XC70: переборка генератора — муфта, подшипники, щётки",
    summary:
      "При свисте ремня на холодную владельцы перебирают генератор: обгонная муфта, подшипники, кольца, реле-регулятор.",
    body: "## Суть\n\nРемонт генератора на **XC70 II** вместо покупки нового узла.\n\n## Практика\n\nСнятие через верх (патрубки интеркулера/радиатора); спецключи на шкив; после сборки зарядка ~14 В.\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/496008662939075337/",
  },

  // ——— P1 ———
  {
    slug: "p1-850-engine-mounts-lemforder",
    platform: "p1",
    topics: ["parts"],
    title: "P1 850: опоры ДВС Lemförder + сайлент 2609201",
    summary:
      "На 850/S70/V70 I верхняя опора и сайлент (Lemförder 2969701 / 2609201) — частая замена при вибрациях и люфтах мотора.",
    body: "## Суть\n\nКомплект опор двигателя на **850**.\n\n## Партномера (примеры)\n\n- Верхняя опора Lemförder **2969701**\n- Сайлент верхней опоры **2609201**\n- Передняя/задние опоры — по каталогу в посте\n\n## Важно\n\nОриентир стрелки на опоре. Выжимка Drive2.",
    url: "https://www.drive2.ru/l/463653059390603323/",
  },
  {
    slug: "p1-850-front-suspension-moog-trw",
    platform: "p1",
    topics: ["parts"],
    title: "P1 850: передняя подвеска Moog/TRW",
    summary:
      "Комплекс передней подвески 850: шаровые Moog VVBJ5554, стойки стаба TRW JTS121, наконечники и сайленты подрамника.",
    body: "## Суть\n\nБольшой фронт ходовой на **850**.\n\n## Партномера (примеры)\n\n- Шаровая: Moog **VVBJ5554**\n- Стойки стабилизатора: TRW **JTS121**\n- Наконечники: Moog **VVES5548/5549**\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/589728285311648460/",
  },
  {
    slug: "p1-s70-tie-rods-sway-bar-moog",
    platform: "p1",
    topics: ["parts"],
    title: "P1 S70: наконечники и стойки стабилизатора Moog/FAG",
    summary:
      "На S70 меняют рулевые наконечники и стойки стаба; Moog VV-DS-0019 держат ~45 ткм, наконечники — чаще.",
    body: "## Суть\n\nРасходники рулевого/стаба на **S70**.\n\n## Партномера\n\n- Стойки: Moog **VV-DS-0019**\n- Наконечники (пример): FAG **840096110 / 840096210**\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/559965055303549300/",
  },
  {
    slug: "p1-850-subframe-bushings-steering",
    platform: "p1",
    topics: ["parts"],
    title: "P1 850: сайленты подрамника + рейка",
    summary:
      "Стук рейки и люфт подрамника на 850 — меняют втулки подрамника Volvo 3507924, опору ДВС и пыльники рейки.",
    body: "## Суть\n\nСвязка рейка + подрамник на **850**.\n\n## Практика\n\nПри снятии рейки часто вскрываются все сайленты подрамника; в комплекте — опоры ДВС Hutchinson и жидкость ГУР.\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/5837632/",
  },
  {
    slug: "p1-850-psf-flush-return-filter",
    platform: "p1",
    topics: ["parts"],
    title: "P1 850: замена жидкости ГУР + фильтр в обратку",
    summary:
      "На 850 жидкость ГУР меняют прокачкой на вывешенных колёсах; некоторые ставят фильтр АКПП в обратную магистраль.",
    body: "## Суть\n\nОбслуживание ГУР на **850** без снятия рейки.\n\n## Практика\n\nВыкачать бачок → крутить руль на вывеске → доливать; опционально фильтр в обратку.\n\n## Важно\n\nНе заводить на сухом насосе. Выжимка Drive2.",
    url: "https://www.drive2.ru/l/681720849794861344/",
  },
];

const existing = loadExistingUrls();
const existingSlugs = new Set(
  fs.readdirSync(ART)
    .filter((x) => x.endsWith(".json"))
    .map((x) => x.replace(/\.json$/, "")),
);

let written = 0;
let skipped = 0;
for (const s of SEED) {
  if (existing.has(normUrl(s.url)) || existingSlugs.has(s.slug)) {
    console.log("skip", s.slug);
    skipped++;
    continue;
  }
  const article = {
    slug: s.slug,
    title: s.title,
    platform: s.platform,
    topics: s.topics,
    summary: s.summary,
    updated: "2026-09-23",
    body_md: s.body,
    links: [{ title: "Пост на Drive2", url: s.url, site: "Drive2" }],
    author: { post_url: s.url },
  };
  fs.writeFileSync(path.join(ART, `${s.slug}.json`), JSON.stringify(article, null, 2) + "\n");
  existing.add(normUrl(s.url));
  existingSlugs.add(s.slug);
  written++;
  console.log("write", s.slug);
}

console.log({ written, skipped, totalSeed: SEED.length });
