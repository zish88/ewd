/**
 * Seed round 3 — more Drive2 curated KB articles.
 * Usage: node scripts/_kb_seed_drive2_round3.mjs && node scripts/_kb_sync_index.mjs
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
  // SPA
  {
    slug: "spa-xc60ii-fluids-filters-120k",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC60 II: масла и фильтры на ~120 ткм",
    summary:
      "На XC60 II к 120 ткм меняют моторное 0W-20, Mann HU8014z/C29021/CUK34003, топливный 32312226, ATF 31492173 и жидкости AWD/Haldex.",
    body: "## Суть\n\nБольшое ТО жидкостей на **XC60 II (SPA)**.\n\n## Партномера (примеры)\n\n- Масляный: Mann **HU8014z**\n- Воздух/салон: **C29021**, **CUK34003**\n- Топливный OEM: **32312226**\n- ATF: **31492173**\n- Haldex / трансмиссия: **32240904**, **32240903**\n\n## Важно\n\nVIN. Выжимка Drive2.",
    url: "https://www.drive2.ru/l/703203932612090105/",
  },
  {
    slug: "spa-xc90-to60-oil-fuel-kl1055",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC90 II: ТО ~60 ткм — масло и KL1055",
    summary:
      "На XC90 II бензин на ТО меняют масляный фильтр 32140029 и топливный Mahle KL1055; сервисный интервал сбрасывают через VTool.",
    body: "## Суть\n\nПлановое ТО **XC90 II** около 60 ткм.\n\n## Партномера\n\n- Масляный OEM: **32140029**\n- Топливный: Mahle/Knecht **KL1055**\n\n## Практика\n\nСброс датчика уровня масла / интервала через **VTool**.\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/696355074682660374/",
  },
  {
    slug: "spa-xc60ii-big-service-brakes-plugs",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC60 II: большое ТО — фильтры, свечи, тормоза",
    summary:
      "Комплекс на XC60 II: фильтры, KL1055, свечи ZXE24HLR7, передние диски 31471752 и колодки 32373124, плюс AWD/АКПП.",
    body: "## Суть\n\nСервисный пакет **XC60 II**: расходники + тормоза + трансмиссия.\n\n## Партномера (примеры)\n\n- Масляный **32140029**, воздух **31370089**, салон **CUK34003**\n- Топливо **KL1055**, свечи **ZXE24HLR7**\n- Диски перед **31471752**, колодки **32373124** / зад **32379535**\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/685826151335085261/",
  },
  {
    slug: "spa-xc90-rear-pads-skf-fuel-32312226",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC90 II: задние колодки SKF + топливный 32312226",
    summary:
      "На XC90 II дизель при скрежете сзади меняют задние колодки (пример SKF VKBP90142) и попутно топливный фильтр OEM 32312226.",
    body: "## Суть\n\nИзнос внутренних задних колодок до металла + плановая замена топливного фильтра.\n\n## Партномера\n\n- Колодки: SKF **VKBP90142**\n- Топливный OEM: **32312226**\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/698013413095256055/",
  },

  // P3
  {
    slug: "p3-xc60-timing-pump-aisin-ina",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC60 I: ГРМ INA + помпа AISIN WV-009",
    summary:
      "На XC60 D5 к ~230 ткм меняют комплект ГРМ INA 530058210, помпу AISIN WV-009, кожух 30757901 и приводные ремни Dayco.",
    body: "## Суть\n\nОчередная замена ГРМ/помпы на **XC60 I D5**.\n\n## Партномера (примеры)\n\n- ГРМ: INA **530058210**\n- Помпа: AISIN **WV-009**\n- Кожух задний: **30757901**\n- Сальник КВ: **31293007**\n- Антифриз: **31439724**\n\n## Важно\n\nКожух ГРМ дубеет — меняют вместе с ремнём. Выжимка Drive2.",
    url: "https://www.drive2.ru/l/704355121286357158/",
  },
  {
    slug: "p3-xc60-turbo-hoses-radiator",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC60 I: патрубки турбины и радиатор ДВС",
    summary:
      "На XC60 D5 течи антифриза/масла часто лечат комплектом патрубков турбины/интеркулера и заменой радиатора со снятием морды.",
    body: "## Суть\n\nСлабое место **XC60 I D5** — патрубки наддува и радиатор охлаждения.\n\n## Практика\n\nРадиатор вынимается со снятием передней панели; попутно моют конденсор/интеркулер, меняют ОЖ.\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/9592067/",
  },
  {
    slug: "p3-xc70-egr-full-replace",
    platform: "p3",
    topics: ["parts", "electrical"],
    title: "P3 XC70 III: полная замена узла EGR",
    summary:
      "На XC70 III D5 при ошибках EGR меняют клапан, радиатор и кожух распределения потока; критично кольцо 30670569.",
    body: "## Суть\n\nКомплексный ремонт **EGR** на P3 D5 вместо «почистил и собрал».\n\n## Партномера\n\n- Кожух/клапан потока: ориентир **31219277**\n- Уплотнительное кольцо: **30670569**\n\n## Важно\n\nРабота трудоёмкая; ошибочная диагностика дорогая. Выжимка Drive2.",
    url: "https://www.drive2.ru/l/568681433732744921/",
  },
  {
    slug: "p3-xc60-turbo-rebuild-big-to",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC60 D5: ремонт турбины + промывка и ТО",
    summary:
      "После ремонта турбины на XC60 D5 делают промывку радиаторов/EGR/патрубков, меняют уплотнения турбины и расходники ТО.",
    body: "## Суть\n\nВосстановление турбокомпрессора + сопутствующее ТО на **XC60 I D5**.\n\n## Практика\n\nКартриджи HD/LP, комплект уплотнений турбины, чистка EGR/дросселя, прожиг сажевого при необходимости.\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/560549445733713430/",
  },
  {
    slug: "p3-xc60-brakes-to150-disks",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC60 I: ТО-150 и тормозные диски",
    summary:
      "На XC60 I к 150 ткм ТО (фильтры, PU9003Z) и замена дисков/колодок; на новые диски ставят новые колодки (OEM из Индии в посте).",
    body: "## Суть\n\nТО + тормоза на **XC60 I**.\n\n## Практика\n\nТопливный Mann **PU9003Z**; при смене дисков — всегда новые колодки (перед/зад артикулы в посте).\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/717171578575527947/",
  },

  // CMA
  {
    slug: "cma-xc40-rear-pads-epb-vida",
    platform: "cma",
    topics: ["parts", "electrical"],
    title: "CMA XC40: задние колодки и EPB через VIDA",
    summary:
      "Задние колодки XC40 (OEM 32276934) требуют разведения электроручника через VIDA до снятия суппорта и адаптации после сборки.",
    body: "## Суть\n\nЗамена задних колодок на **XC40** сложнее передних из‑за EPB.\n\n## Партномера\n\n- Колодки OEM: **32276934** (в БЖ одинаковы для 15″/16″)\n\n## Практика\n\nДо снятия — развести привод ручника диагностикой; после — свести и адаптировать. Иначе риск моторчиков EPB.\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/605960375472491750/",
  },
  {
    slug: "cma-xc40-atf-31492173-diy",
    platform: "cma",
    topics: ["parts"],
    title: "CMA XC40 T3: частичная замена ATF 31492173",
    summary:
      "На XC40 1.5 T3 сливают ATF через пробку/переливную трубку и заливают ~4 л OEM 31492173, уровень по температуре ~50°C.",
    body: "## Суть\n\nDIY-обслуживание АКПП на **XC40 T3**.\n\n## Партномера\n\n- ATF OEM: **31492173**\n\n## Практика\n\nСнять корпус воздушного фильтра для доступа; после заливки прогрев и контроль перелива.\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/720465440534435687/",
  },
  {
    slug: "cma-xc40-atf-machine-flush",
    platform: "cma",
    topics: ["parts", "links"],
    title: "CMA XC40: аппаратная замена ATF — опыт владельца",
    summary:
      "Владельцы XC40 спорят частичная vs аппаратная замена ATF; в БЖ на ~30–60 ткм делают аппаратную на Motul ATF VI у дилера.",
    body: "## Суть\n\nВыбор метода замены масла АКПП на **XC40**.\n\n## Практика\n\nЧастичное вытеснение 8–12 л OEM vs аппаратная замена; оригинал дорогой и часто подделывают.\n\n## Важно\n\nНе регламент Volvo — опыт БЖ. Выжимка Drive2.",
    url: "https://www.drive2.ru/l/701543120298316198/",
  },

  // P2
  {
    slug: "p2-xc70-psf-pump-replace",
    platform: "p2",
    topics: ["parts"],
    title: "P2 XC70: замена насоса ГУР и жидкости",
    summary:
      "На XC70 II при рекомендации «менять насос» часто ограничиваются жидкостью; при замене насоса проверяют клапан регулировки на корпусе.",
    body: "## Суть\n\nОбслуживание ГУР на **XC70 II**: жидкость ± насос.\n\n## Практика\n\nРодной насос может не гудеть годами при грязном шкиве; на новом насосе клапан иногда недокручен с завода — проверяют до установки.\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/678318411062717335/",
  },
  {
    slug: "p2-xc70-steering-rack-bushings",
    platform: "p2",
    topics: ["parts"],
    title: "P2 XC70: капремонт рейки + сайленты рычагов SKF",
    summary:
      "Люфт/щелчки руля на XC70 II — капремонт рейки (вал), тяги Lemförder; сайленты передних рычагов SKF VKDS 336022/336023.",
    body: "## Суть\n\nРулевое + передние рычаги на **XC70 II**.\n\n## Партномера\n\n- Сайленты: SKF **VKDS 336022**, **VKDS 336023**\n\n## Важно\n\nРейка XC90 vs XC70 — проверять совместимость тяг. Выжимка Drive2.",
    url: "https://www.drive2.ru/l/583170248207801618/",
  },
  {
    slug: "p2-v70-abs-ring-springs",
    platform: "p2",
    topics: ["parts", "electrical"],
    title: "P2 V70: кольцо ABS Metzger + пружины Lesjöfors",
    summary:
      "Отключение ABS >50 км/ч на V70 II часто из‑за лопнувшего зубчатого кольца (Metzger 0900164); попутно ставят пружины Lesjöfors 4095837.",
    body: "## Суть\n\nОшибка датчика ABS + просевшие пружины на **V70 II**.\n\n## Партномера\n\n- Кольцо ABS: Metzger **0900164**\n- Пружины: Lesjöfors **4095837** (пример от XC70 D5)\n\n## Важно\n\nРжавая ступица раздавливает кольцо. Выжимка Drive2.",
    url: "https://www.drive2.ru/l/600417462478971534/",
  },
  {
    slug: "p2-xc70-abs-rings-febi-hubs",
    platform: "p2",
    topics: ["parts", "electrical"],
    title: "P2 XC70: кольца ABS FEBI при замене ступиц",
    summary:
      "При замене передних ступиц на XC70 II меняют зубчатые кольца ABS (FEBI 100751): нагрев при посадке, не бить по зубьям.",
    body: "## Суть\n\nПрофилактика колец ABS на приводах **XC70 II**.\n\n## Партномера\n\n- Кольцо: FEBI **100751**\n\n## Практика\n\nСнятие молотком аккуратно; установка с прогревом, набивка через деревяшку.\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/662278735436729320/",
  },

  // P1
  {
    slug: "p1-850-timing-pump-gmb-ina",
    platform: "p1",
    topics: ["parts"],
    title: "P1 850: ГРМ INA + помпа GMB + сальник КВ",
    summary:
      "На 850 комплект ГРМ INA 530004410, помпа GMB GWVO07A и сальник Corteco; помпу меняют по пробегу — люфт по оси не всегда заметен рукой.",
    body: "## Суть\n\nЗамена привода ГРМ и помпы на **850**.\n\n## Партномера (примеры)\n\n- ГРМ: INA/LuK **530004410**\n- Помпа: GMB **GWVO07A**\n- Сальник КВ: Corteco **20019851B**\n\n## Практика\n\nПроверять метки — встречался сдвиг на 2 зуба без катастрофы, но мотор «оживает» после правки.\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/504585953147356061/",
  },
  {
    slug: "p1-850-timing-aisin-pump",
    platform: "p1",
    topics: ["parts"],
    title: "P1 850: ГРМ + помпа Aisin на большом пробеге",
    summary:
      "На 850 с пробегом ~480 ткм меняют оригинал ремня, помпу/натяжитель Aisin и ролики INA; сальник КВ — обязательно.",
    body: "## Суть\n\nПлановая замена ГРМ на высокопробежном **850**.\n\n## Практика\n\nРемень явно «к замене», помпа с шумом, ролики часто ещё живые — всё равно меняют комплектом.\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/689270921264903003/",
  },
  {
    slug: "p1-s70-heater-core-replace",
    platform: "p1",
    topics: ["parts"],
    title: "P1 S70: замена радиатора печки",
    summary:
      "На S70 течь радиатора печки заливает салон; б/у живёт недолго — лучше новый, временно можно закольцевать контур ОЖ.",
    body: "## Суть\n\nКлассика **S70/850**: пробитая печка.\n\n## Практика\n\nЗакольцовка до дома → разбор салона/сушка → новый радиатор (Hella и аналоги).\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/631531442521770302/",
  },
  {
    slug: "p1-s70-timing-belt-gotchas",
    platform: "p1",
    topics: ["parts"],
    title: "P1 S70: замена ГРМ — слизыва торкса натяжного ролика",
    summary:
      "На S70 при замене ГРМ часто срывают Torx натяжного ролика у лонжерона; доступ проще после снятия помпы и кожуха.",
    body: "## Суть\n\nПодводные камни DIY ГРМ на **S70**.\n\n## Практика\n\nБита Torx должна сидеть глубоко; при срыве — снимать помпу/кожух; после сборки — два оборота КВ и контроль меток.\n\n## Важно\n\nВыжимка Drive2.",
    url: "https://www.drive2.ru/l/681793967318112545/",
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
