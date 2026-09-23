/**
 * Bulk-seed ~55 curated KB articles from Drive2 (unique URLs only).
 * Usage: node scripts/_kb_bulk_seed50.mjs
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
  // ——— P3 (18) ———
  {
    slug: "p3-glow-plugs-bosch-008",
    platform: "p3",
    topics: ["parts"],
    title: "P3 D5: свечи накала Bosch 0 250 603 008",
    summary:
      "На XC60/XC70 D5 при ошибке по свече часто меняют комплект. Популярный кросс OEM 30777311 — Bosch 0250603008.",
    body: "## Суть\n\nДизель **P3 D5**: вибрация на холодную / код по свече. Владельцы меняют **все** свечи комплектом.\n\n## Партномера\n\n- OEM ориентир: **30777311**\n- Bosch: **0 250 603 008**\n\n## Важно\n\nСверяйте по VIN. Выжимка Drive2.",
    url: "https://www.drive2.ru/l/686341272532697115/",
  },
  {
    slug: "p3-glow-plugs-xc60-bosch",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC60: свечи накала — комплект Bosch перед зимой",
    summary:
      "На XC60 I D5 при ~170 ткм меняют свечи накала комплектом Bosch (тот же, что в оригинале), даже если сопротивление «норм».",
    body: "## Суть\n\nПрофилактика холодного пуска на **XC60 D5**: комплект свечей накала Bosch.\n\n## Практика\n\nМеняют все сразу. Старые могут «звонить» тестером, но уже слабые на нагрузке.\n\n## Важно\n\nVIN обязателен.",
    url: "https://www.drive2.ru/l/691554057159968724/",
  },
  {
    slug: "p3-glow-plugs-dg620",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC70: свечи накала DG620 / Bosch 0250403001",
    summary:
      "Альтернативные комплекты на XC70 III: DG620 и Bosch 0 250 403 001. Неустойчивый холодный пуск — типичный повод.",
    body: "## Суть\n\nНа **XC70 III D5** свечи накала — зимний расходник.\n\n## Партномера\n\n- **DG620**\n- Bosch **0 250 403 001**\n\n## Важно\n\nНе путать с бензиновыми свечами.",
    url: "https://www.drive2.ru/l/730271709864657674/",
  },
  {
    slug: "p3-glow-plugs-bosch-403",
    platform: "p3",
    topics: ["parts"],
    title: "P3: быстрая замена свечей Bosch 0 250 403 001",
    summary: "Короткий опыт замены свечей накала на XC70 D5 комплектом Bosch 0250403001 (~30 мин).",
    body: "## Суть\n\nЗамена комплектом Bosch **0 250 403 001** на **XC70 D5**.\n\n## Важно\n\nМеняйте все сразу. VIN!",
    url: "https://www.drive2.ru/l/490334358306029839/",
  },
  {
    slug: "p3-radiator-ac-pack",
    platform: "p3",
    topics: ["parts"],
    title: "P3: пакет радиаторов ДВС + кондиционер",
    summary:
      "На XC70 III при гуле компрессора/рассыпанных сотах меняют радиатор ДВС, кондёра и уплотнения (пример 988847).",
    body: "## Суть\n\nПакет радиаторов на **P3** часто меняют сразу: ДВС + кондиционер.\n\n## Что берут\n\n- Радиаторы — по VIN\n- Уплотнения (пример **988847**)\n- ОЖ Volvo (**31439721** / аналоги)\n\n## Важно\n\nПосле работ — вакуум/заправка кондиционера.",
    url: "https://www.drive2.ru/l/667479425436090700/",
  },
  {
    slug: "p3-battery-bms-note",
    platform: "p3",
    topics: ["parts"],
    title: "P3: АКБ и «врёт» BMS на приборке",
    summary:
      "На XC70 III после старой батареи BMS может показывать низкий заряд при живом АКБ. Меняют батарею; иногда помогает сброс.",
    body: "## Суть\n\nНа **P3** с Webasto зимой АКБ критичен. Сообщение о разряде ≠ «сдохла банка».\n\n## Практика\n\n1. Замер тестером.\n2. Замена по размеру/току.\n3. Сброс счётчика через диагностику при необходимости.\n\n## Важно\n\nПолярность и DIN-размер — по VIN.",
    url: "https://www.drive2.ru/l/653152514048274062/",
  },
  {
    slug: "p3-water-pump-aisin",
    platform: "p3",
    topics: ["parts"],
    title: "P3 D5: помпа AISIN WV-009 и комплект ГРМ",
    summary:
      "При замене ГРМ на D5 часто ставят помпу AISIN WV-009 (30751022) + комплект 31359568. Проверьте комплект болтов.",
    body: "## Суть\n\nПомпа ОЖ на **P3 D5** обычно идёт пакетом с **ГРМ**.\n\n## Партномера\n\n- Помпа: **AISIN WV-009** / **30751022**\n- ГРМ: **31359568**\n- Навесной: **31401425**\n\n## Важно\n\nСверяйте болты в коробке.",
    url: "https://www.drive2.ru/l/587588360806072610/",
  },
  {
    slug: "p3-service-log-xc60",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC60: лог ТО — топливный фильтр и радиаторы",
    summary:
      "Типовой сервисный лог XC60 I D5: топливный фильтр, мойка/замена радиатора, масло редукторов — как чеклист интервалов.",
    body: "## Суть\n\nЧеклист из лога **XC60 P3**: топливный фильтр, радиаторы, масла редукторов/Haldex.\n\n## Важно\n\nИнтервалы — ориентир. VIN важнее чужого лога.",
    url: "https://www.drive2.ru/l/710859282320470054/",
  },
  {
    slug: "p3-to-webasto-pump",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC70: ТО + помпа Webasto Pierburg",
    summary:
      "На ТО XC70 III D5: масло 5W-30, фильтр 30788490, воздух 31370161, ТЖ + помпа Webasto 702671500 Pierburg при вое моторчика.",
    body: "## Суть\n\nПлановое ТО **XC70 D5** + замена помпы отопителя Webasto.\n\n## PN\n\n- Масляный OEM **30788490**\n- Воздух **31370161**\n- Помпа Webasto **702671500** (Pierburg)\n\n## Важно\n\nВой «печки» при выключенном климате — смотрите помпу предпускового.",
    url: "https://www.drive2.ru/l/692907555973778006/",
  },
  {
    slug: "p3-oil-filters-diy",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC70: масло + все фильтры своими руками",
    summary:
      "DIY на XC70 III: Castrol 0W-30, MANN HU7198X, воздух 31370161, топливный PU9003Z; сброс сервиса через VIDA/DIM.",
    body: "## Суть\n\nПолная замена масла и фильтров на **XC70 D5**.\n\n## PN\n\n- Масляный **MANN HU7198X**\n- Воздух Volvo **31370161**\n- Топливный **MANN PU9003Z**\n\n## Практика\n\nПосле топливного — 3–4 цикла зажигания до пуска. Сброс индикатора ТО через диагностику.",
    url: "https://www.drive2.ru/l/540972366323253874/",
  },
  {
    slug: "p3-to150-belt-brakes",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC70: ТО-150 — ремни и задние тормоза",
    summary:
      "ТО-150: масло C3 5W-30, HU719/8Y, C35177, комплект навесного 31401425, ремень кондёра 31325042, зад Brembo 09.9587.11 / P86021.",
    body: "## Суть\n\nБольшое ТО **XC70 III** с ремнями и задними тормозами.\n\n## PN\n\n- Навесной комплект **31401425**\n- Ремень кондиционера **31325042**\n- Зад диск Brembo **09.9587.11**, колодки **P86021**\n- ТЖ Volvo **32214958**\n\n## Важно\n\nРазмер диска — по VIN.",
    url: "https://www.drive2.ru/l/662195172553012764/",
  },
  {
    slug: "p3-coolant-hose-drain",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC70: патрубок ОЖ и дренажная трубка 31274900",
    summary:
      "На ТО XC70 III меняют верхний патрубок ОЖ и ставят дренажную трубку 31274900; фильтры MANN/Hengst, масло 0W-30 A5/B5.",
    body: "## Суть\n\nВоздух в системе ОЖ / течь патрубка на **P3 D5**.\n\n## PN\n\n- Дренаж: **31274900**\n- Воздух MANN **C35177**\n- Топливный Hengst **E100KP01D182**\n\n## Важно\n\nСмотрите моточасы в борткомпьютере, не только км.",
    url: "https://www.drive2.ru/l/702619267304008486/",
  },
  {
    slug: "p3-to130-mann-set",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC70: ТО-130 — набор MANN + Castrol C3",
    summary:
      "Классический набор: C35177, PU9003Z, HU7198Y, CUK2733 и Castrol 0W-30 C3. Часто совмещают с чисткой EGR.",
    body: "## Суть\n\nТиповой фильтр-набор **XC70 D5** на среднем ТО.\n\n## PN\n\n- Воздух **MANN C35177**\n- Топливный **PU9003Z**\n- Масляный **HU7198Y**\n- Салонный **CUK2733**\n\n## Важно\n\nКроссы к OEM — сверяйте по VIN.",
    url: "https://www.drive2.ru/l/636700246683948045/",
  },
  {
    slug: "p3-timing-xc60-big",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC60: ГРМ 31359568 + кожухи + жидкости",
    summary:
      "На ~190 ткм XC60 I D5: ГРМ 31359568, ремень кондёра 31325042, кожухи 30757900/30757901, масла ДВС/АКПП/редукторов/Haldex.",
    body: "## Суть\n\nБольшой сервис ГРМ на **XC60 P3 D5**.\n\n## PN\n\n- ГРМ **31359568**\n- Кожухи **30757900** / **30757901**\n- Ремень кондёра **31325042**\n\n## Важно\n\nРезина кожухов дубеет и может попасть под ремень — меняют превентивно.",
    url: "https://www.drive2.ru/l/712700139663267187/",
  },
  {
    slug: "p3-timing-pump-diy-xc60",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC60: ГРМ + помпа AISIN своими руками",
    summary:
      "DIY: помпа AISIN WV-009 + болты 985151, сальник КВ 31293007, антифриз 31439724, шкив 31258133, ремни Dayco.",
    body: "## Суть\n\nСамостоятельная замена ГРМ/помпы на **XC60 D5**.\n\n## PN\n\n- Помпа **AISIN WV-009**\n- Болты **985151**\n- Сальник КВ **31293007**\n- ОЖ **31439724**\n\n## Важно\n\nРесурс роликов INA в БЖ — ориентир, не гарантия.",
    url: "https://www.drive2.ru/l/704355121286357158/",
  },
  {
    slug: "p3-xc60-brakes-battery-cover",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC60: тормоза по кругу + крышка АКБ",
    summary:
      "На сервисе XC60 I: ГРМ 31359568, тормоза по кругу, ТЖ; высокая крышка АКБ 31335286 при сломанной штатной.",
    body: "## Суть\n\nКомплекс: тормоза + ГРМ + мелочи АКБ на **XC60 P3**.\n\n## PN\n\n- ГРМ **31359568**\n- Крышка АКБ **31335286**\n\n## Важно\n\nТолщина диска — сверяйте с VIDA/мануалом.",
    url: "https://www.drive2.ru/l/603223141275155562/",
  },
  {
    slug: "p3-xc60-brakes-ate-trw",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC60: колодки ATE перед / TRW зад",
    summary:
      "ТО-180: HU7198Y, C35177, PU9003Z, CUK2733; перед ATE 13.0460-7272.2, зад TRW GDB1685, ТЖ DOT4 ESP.",
    body: "## Суть\n\nТормоза + фильтры на **XC60 I D5**.\n\n## PN\n\n- Перед колодки ATE **13.0460-7272.2**\n- Зад TRW **GDB1685**\n- Фильтры MANN как выше\n\n## Важно\n\nСуппорты смазывают при замене колодок.",
    url: "https://www.drive2.ru/l/591464414171895567/",
  },
  {
    slug: "p3-s60ii-consumables-sheet",
    platform: "p3",
    topics: ["parts"],
    title: "P3 S60 II: шпаргалка расходников на ТО",
    summary:
      "Сводная: масло 31330050 / Mann W7015, воздух 31370161 / C35177, салон 31390880 / CUK2733; колодки по размеру диска 16″/16.5″.",
    body: "## Суть\n\nШпаргалка ТО для **S60 II** (поколение P3).\n\n## PN\n\n- Масляный **31330050** / Mann **W7015**\n- Воздух **31370161** / **C35177**\n- Салон **31390880** / **CUK2733**\n- Колодки: TRW **GDB1683/1684**, зад **GDB1685**\n\n## Важно\n\nВсегда VIN.",
    url: "https://www.drive2.ru/l/361510/",
  },

  // ——— P2 (14) ———
  {
    slug: "p2-spark-plugs-8642660",
    platform: "p2",
    topics: ["parts"],
    title: "P2 S60: свечи OEM 8642660 + тормоза Zimmermann",
    summary:
      "На бензиновом S60 1G в большом ТО: свечи 8642660 (Beru Z204) и часто Zimmermann диски/колодки перед/зад.",
    body: "## Суть\n\n**S60/V70 P2** бензин: свечи + тормоза в одном ТО.\n\n## PN\n\n- Свечи **8642660** / Beru **Z204**\n- Zimmermann перед диск **610.3701.20**, колодки **23073.190.1**\n- Зад **610.3703.20** / **23076.175.1**\n\n## Важно\n\nРазмер диска — по опциям.",
    url: "https://www.drive2.ru/l/593080971142653800/",
  },
  {
    slug: "p2-thermostat-gates-insert",
    platform: "p2",
    topics: ["parts"],
    title: "P2: вставка термостата Gates TH35991",
    summary:
      "При скачущей температуре на трассе меняют вставку Gates TH35991 и прокладку VO31293699GA.",
    body: "## Суть\n\nТемпература «плавает» — классика мёртвого термостата на **P2**.\n\n## PN\n\n- Вставка **Gates TH35991**\n- Прокладка **VO31293699GA**\n\n## Важно\n\nНе путать с полным корпусом OEM.",
    url: "https://www.drive2.ru/l/727748605556823914/",
  },
  {
    slug: "p2-coolant-tank-hose",
    platform: "p2",
    topics: ["parts"],
    title: "P2 XC70 II: бачок ОЖ 30741973 и патрубки",
    summary:
      "Течи бачка: OEM 30741973, шланг 30680923, термостат Wahler 4272.90D, верхний патрубок Gates 02-2251.",
    body: "## Суть\n\nВозрастная система ОЖ на **XC70 II / P2**.\n\n## PN\n\n- Бачок **30741973**\n- Шланг **30680923**\n- Термостат **Wahler 4272.90D**\n- Патрубок Gates **02-2251**\n\n## Важно\n\nПромывка + свежий антифриз.",
    url: "https://www.drive2.ru/l/518685265628233841/",
  },
  {
    slug: "p2-battery-30659798",
    platform: "p2",
    topics: ["parts"],
    title: "P2: АКБ Volvo 30659798 70 А·ч",
    summary:
      "Типовой размер для многих P2: Volvo 30659798 — 70 А·ч, 600 А, обратная полярность.",
    body: "## Суть\n\nПодбор АКБ на **S60/V70 P2**.\n\n## Ориентир\n\n- OEM **30659798**\n- ~70 А·ч / 600 А / обратная полярность\n\n## Важно\n\nR/опции могут отличаться. VIN!",
    url: "https://www.drive2.ru/l/617587985814144537/",
  },
  {
    slug: "p2-filters-purflux-set",
    platform: "p2",
    topics: ["parts"],
    title: "P2: фильтры Purflux на плановое ТО",
    summary:
      "На S60 1G: масляный Purflux L316, воздушный A1144, салонный AHC173.",
    body: "## Суть\n\nБазовое ТО **P2**: масло + три фильтра.\n\n## PN\n\n- **Purflux L316** / **A1144** / **AHC173**\n\n## Важно\n\nКроссы к OEM — сверяйте.",
    url: "https://www.drive2.ru/l/675579802475823924/",
  },
  {
    slug: "p2-oem-filters-9454647",
    platform: "p2",
    topics: ["parts"],
    title: "P2: OEM фильтры 9454647 / 30630754 / 1275810",
    summary:
      "В полном ТО S60 1G: масляный 1275810, воздушный 9454647, салонный 30630754, топливный 32242189, свечи 8642660.",
    body: "## Суть\n\nШпаргалка OEM для **P2 бензин**.\n\n## Список\n\n- Масляный **1275810**\n- Воздушный **9454647**\n- Салонный **30630754**\n- Топливный **32242189**\n- Свечи **8642660**\n\n## Важно\n\nДизель — другие номера.",
    url: "https://www.drive2.ru/l/673680121260943259/",
  },
  {
    slug: "p2-brakes-round-s60",
    platform: "p2",
    topics: ["parts"],
    title: "P2 S60: тормоза по кругу и диски 305 мм",
    summary:
      "На S60 1G меняют тормоза вкруг; для 305 мм спереди нужны другие скобы. Часто OEM спереди + ATE сзади.",
    body: "## Суть\n\nПолная переборка тормозов **S60 P2**.\n\n## Практика\n\nСуппорты чистят/красят, поршни и пыльники — по состоянию. 305 мм — замена скоб.\n\n## Важно\n\nРазмер диска зависит от комплектации.",
    url: "https://www.drive2.ru/l/599697832118603487/",
  },
  {
    slug: "p2-brake-substitutes-ate",
    platform: "p2",
    topics: ["parts"],
    title: "P2: подбор заменителей тормозов — ATE/Brembo/TRW",
    summary:
      "Сравнительный подбор дисков/колодок и ТЖ ATE SL.6; отдельно тросы ручника и колодки стояночного тормоза.",
    body: "## Суть\n\nВыбор брендов тормозов на **S60 1G**.\n\n## Практика\n\nЧасто берут **ATE**; ТЖ ориентир **ATE SL.6** (DOT4). Ручник — тросы + колодки отдельно.\n\n## Важно\n\nДлина шлангов различается перед/зад.",
    url: "https://www.drive2.ru/l/733535885009623326/",
  },
  {
    slug: "p2-thermostat-facet-coolant",
    platform: "p2",
    topics: ["parts"],
    title: "P2 S60: термостат Facet 78606 + ОЖ 31439724",
    summary:
      "Зимой салон не греется / стрелка еле ползёт: Facet 78606, оригинал ОЖ 31439724, болты крепления 986228.",
    body: "## Суть\n\nЗамена термостата и антифриза на **S60 P2**.\n\n## PN\n\n- Термостат **Facet 78606**\n- ОЖ Volvo **31439724**\n- Болты **986228**\n\n## Важно\n\nOEM-корпус дорогой — аналог вставки/корпуса выбирают осознанно.",
    url: "https://www.drive2.ru/l/660188838710237783/",
  },
  {
    slug: "p2-thermostat-insert-v70",
    platform: "p2",
    topics: ["parts"],
    title: "P2 V70: «хитрый» термостат — только вставка",
    summary:
      "На рестайловых моторах V70 II продают термостат в сборе дорого; владельцы ищут правильную вставку и меняют со сливом ОЖ.",
    body: "## Суть\n\nЭкономия: вставка вместо корпуса на **V70 II**.\n\n## Практика\n\nСнять колесо/ремень, слить ОЖ, не перепутать артикул вставки.\n\n## Важно\n\n«Не та» вставка из магазина — частая ошибка.",
    url: "https://www.drive2.ru/l/457698929048322102/",
  },
  {
    slug: "p2-vkg-thermostat-ac-rad",
    platform: "p2",
    topics: ["parts"],
    title: "P2 V70: ВКГ, термостат Wahler, радиатор кондиционера",
    summary:
      "Пакет работ: ВКГ, термостат Wahler 481890D, радиатор кондиционера, обгонная муфта генератора.",
    body: "## Суть\n\nКомплексный «возрастной» пакет на **V70 II**.\n\n## PN\n\n- Термостат (корпус) Wahler **481890D**\n\n## Важно\n\nПостоянно крутящийся вентилятор — смотрите кондиционер/радиатор.",
    url: "https://www.drive2.ru/l/576822492702704513/",
  },
  {
    slug: "p2-xc70-oil-thermostat-gparts",
    platform: "p2",
    topics: ["parts"],
    title: "P2 XC70: масло + вставка термостата GParts",
    summary:
      "На большом пробеге XC70 II: масляный 1275810, вставка VO31293699TH; для установки вставки удобнее снять насос ГУР.",
    body: "## Суть\n\nТО масла + термостат на **XC70 II**.\n\n## PN\n\n- Масляный **1275810**\n- Вставка **VO31293699TH**\n\n## Практика\n\nСтавить вставку проще со снятым насосом ГУР.",
    url: "https://www.drive2.ru/l/666060780558377979/",
  },
  {
    slug: "p2-xc70-filters-denso-spark",
    platform: "p2",
    topics: ["parts"],
    title: "P2 XC70: фильтры + свечи Denso IK20",
    summary:
      "После покупки: Denso IK20, Hengst E15HD58, Filtron AP1652, ALCO SP2145, салон TSN 97252; клипсы топливных быстросъёмов часто мёртвые.",
    body: "## Суть\n\nПервое ТО после покупки **XC70 II**.\n\n## PN\n\n- Свечи **Denso IK20**\n- Масляный Hengst **E15HD58**\n- Воздух Filtron **AP1652**\n- Топливный ALCO **SP2145**\n\n## Важно\n\nБыстросъёмы топливного — готовьте ремонт/хомуты.",
    url: "https://www.drive2.ru/l/735032870090839321/",
  },
  {
    slug: "p2-xc70-brakes-ate-service",
    platform: "p2",
    topics: ["parts"],
    title: "P2 XC70: обслуживание передних тормозов ATE",
    summary:
      "Направляющие ATE 11.8171-0008.1, ремкомплект 11.0441-6008.2, колодки 13.0470-7145.2, диск 24.0128-0123.1; штуцер берите длинный 03.3518-1900.2.",
    body: "## Суть\n\nПереборка передних тормозов **XC70 II** на ATE.\n\n## PN\n\n- Колодки **13.0470-7145.2**\n- Диск **24.0128-0123.1**\n- Штуцер **03.3518-1900.2** (короткий не подходит)\n\n## Важно\n\nЗад иногда берут размер от XC90 — сверяйте.",
    url: "https://www.drive2.ru/l/652276478158842414/",
  },

  // ——— P1 (10) ———
  {
    slug: "p1-first-service-parts-list",
    platform: "p1",
    topics: ["parts"],
    title: "P1 S70: первичный список расходников",
    summary:
      "После покупки S70: Filtron K1117/PP866, Denso IK20TT, лампы OSRAM H7/P21W, щётки Bosch 3397118400.",
    body: "## Суть\n\nЧеклист расходников для **S70/850**.\n\n## Примеры\n\n- Салонный Filtron **K1117**\n- Топливный **PP866**\n- Свечи Denso **IK20TT**\n- Лампы OSRAM H7 **64210**\n\n## Важно\n\nНабор одного БЖ — сверяйте VIN.",
    url: "https://www.drive2.ru/l/683568304207431924/",
  },
  {
    slug: "p1-parts-catalog-850",
    platform: "p1",
    topics: ["parts"],
    title: "P1 850: шпаргалка PN подвески и ламп",
    summary:
      "Сводная: шаровая FEBI 1475, наконечники Lemförder 2013602/2013701, колодки зад TRW GDB1160, лампы H1/H7/P21W.",
    body: "## Суть\n\n«Тетрадка» партномеров для **850**.\n\n## Важно\n\nНе все позиции универсальны на все годы.",
    url: "https://www.drive2.ru/l/526113566185489217/",
  },
  {
    slug: "p1-ball-joints-tie-rods",
    platform: "p1",
    topics: ["parts"],
    title: "P1: шаровые и рулевые наконечники",
    summary:
      "На 850 при диагностике ходовой часто убиты шаровые и наконечники. Ставят оригинал/TRW/Lemförder; после — сход-развал.",
    body: "## Суть\n\nПередняя подвеска **850** — типичная точка вложений.\n\n## Практика\n\nШаровые + наконечники пакетом; сайленты рычагов — по состоянию.\n\n## Важно\n\nПосле работ — сход-развал.",
    url: "https://www.drive2.ru/l/574868660540145688/",
  },
  {
    slug: "p1-v70-timing-filters",
    platform: "p1",
    topics: ["parts"],
    title: "P1 V70: ГРМ Dayco + фильтры Patron",
    summary:
      "На V70 I: комплект Dayco KTMBWP3160 (помпа/ролики/ремень), фильтры Patron PF2047/PF1018/PF4113, свечи NGK BKR6E.",
    body: "## Суть\n\nПлановое ТО с ГРМ на **V70 I**.\n\n## PN\n\n- ГРМ Dayco **KTMBWP3160**\n- Фильтры Patron **PF2047** / **PF1018** / **PF4113**\n- Свечи NGK **BKR6E**\n\n## Важно\n\nДаже «свежий» комплект INA владельцы часто меняют от греха.",
    url: "https://www.drive2.ru/l/642247557723984589/",
  },
  {
    slug: "p1-s70-first-to-filters",
    platform: "p1",
    topics: ["parts"],
    title: "P1 S70: первое ТО — Patron / Knecht / Mann",
    summary:
      "После покупки S70: воздух PF1018, салон PF2047, масло Knecht OC204, топливный Mann WK849, ГРМ Metelli 30-1019-1.",
    body: "## Суть\n\nПервое успокаивающее ТО **S70**.\n\n## PN\n\n- Воздух Patron **PF1018**\n- Салон **PF2047**\n- Масляный Knecht **OC204**\n- Топливный Mann **WK849**\n\n## Важно\n\nГРМ проверяйте комплектом, не «на глаз».",
    url: "https://www.drive2.ru/l/665678975145622598/",
  },
  {
    slug: "p1-rear-pads-v70-fwd",
    platform: "p1",
    topics: ["parts"],
    title: "P1: задние колодки V70-I FWD — нюансы формы",
    summary:
      "На переднеприводных 850/S70/V70 задние двухпоршневые ATE: важна выемка/форма колодки; 850 и 70-I в каталогах путают.",
    body: "## Суть\n\nПодбор задних колодок **V70 I FWD** — не «любые от 850».\n\n## Практика\n\nСверяйте фото/выемку с OEM. ATE — разработчик суппорта.\n\n## Важно\n\nОшибочный формфактор = скрип/неравномерный износ.",
    url: "https://www.drive2.ru/l/597000455217748644/",
  },
  {
    slug: "p1-oem-pads-blue-box",
    platform: "p1",
    topics: ["parts"],
    title: "P1 850: OEM колодки 31341243 / 30793802",
    summary:
      "Перед 31341243, зад 30793802, пластины 272272 и 1359772 — «синие коробки»; скрип после дешёвых GP уходит.",
    body: "## Суть\n\nОригинальные колодки на **850**.\n\n## PN\n\n- Перед **31341243**\n- Зад **30793802**\n- Пластины **272272** / **1359772**\n\n## Важно\n\nПередние пластины часто не предусмотрены конструкцией.",
    url: "https://www.drive2.ru/l/476439829865824904/",
  },
  {
    slug: "p1-trw-pads-gdb1406",
    platform: "p1",
    topics: ["parts"],
    title: "P1 V70: передние колодки TRW GDB1406 vs GDB1159",
    summary:
      "На V70 I с 15″: GDB1406 без выреза под датчик (как OEM) vs GDB1159 с местом под датчик — на V70 датчика не было.",
    body: "## Суть\n\nВыбор передних колодок TRW для **V70 I**.\n\n## PN\n\n- Предпочтительно **GDB1406** (больше площадь, без датчика)\n- **GDB1159** — с вырезом под датчик (наследие 850)\n\n## Важно\n\nБольшинство брендов делают «под датчик» для унификации.",
    url: "https://www.drive2.ru/l/552704155391623577/",
  },
  {
    slug: "p2-washer-pumps-mapco",
    platform: "p2",
    topics: ["parts"],
    title: "P2 S60: насосы омывателя стекла и фар",
    summary:
      "Зимой умирают оба насоса: стекло и фары. Аналоги вроде MAPCO 90604 / MEYLE 3130670001; насос фар — со снятием бампера.",
    body: "## Суть\n\nДва насоса в бачке на **S60 P2**: лобовое и фары.\n\n## Практика\n\nСлейте незамерзайку, меняйте насос стекла без бампера; насос фар — бампер и аккурат с фишкой.\n\n## Важно\n\nБыстросъём шланга фар часто одноразовый.",
    url: "https://www.drive2.ru/l/518493675727093772/",
  },
  {
    slug: "p2-alternator-replace-gates",
    platform: "p2",
    topics: ["parts"],
    title: "P2 S60: замена генератора сверху + ремень Gates",
    summary:
      "Гул подшипников/обгонной: генератор снимают сверху после вентилятора; попутно ремень Gates 6DPK1838 и ролик INA 531076010.",
    body: "## Суть\n\nЗамена генератора на **S60 P2** через верх.\n\n## Практика\n\nСнять вентилятор → ремень → болты через компрессор → вытащить вверх.\n\n## PN рядом\n\n- Ремень Gates **6DPK1838**\n- Ролик INA/LUK **531076010**\n\n## Важно\n\nПроверяйте обгонную муфту отдельно.",
    url: "https://www.drive2.ru/l/634966866602754319/",
  },

  // ——— CMA (8) ———
  {
    slug: "cma-to2-oem-filters",
    platform: "cma",
    topics: ["parts"],
    title: "CMA XC40: ТО-2 — OEM 32257032 / 32146443",
    summary:
      "На ТО-2: масляный 32257032 + 977751, топливный 31465948, салонный 31497285, воздушный 32146443, масло 0W-20.",
    body: "## Суть\n\nШпаргалка OEM для **XC40**.\n\n## Список\n\n- Масляный **32257032** + **977751**\n- Топливный **31465948**\n- Салонный **31497285**\n- Воздушный **32146443**\n\n## Важно\n\n1.5T / B4 могут отличаться.",
    url: "https://www.drive2.ru/l/620699328842829649/",
  },
  {
    slug: "cma-oil-filter-brakes-zimmermann",
    platform: "cma",
    topics: ["parts"],
    title: "CMA XC40: ТО + тормоза Zimmermann",
    summary:
      "Масляный 32140029, воздух C24051/1, салон CUK29010; диски 610.3725.20 / 610.3732.20, колодки 26126.185.2 / 20510.175.2.",
    body: "## Суть\n\nТО и тормоза по кругу на **XC40** 2.0.\n\n## PN\n\n- Фильтр **32140029**\n- Zimmermann диски/колодки как в summary\n\n## Важно\n\nМасло 0W-20 — типичный допуск для CMA.",
    url: "https://www.drive2.ru/l/707957121378947698/",
  },
  {
    slug: "cma-to1-oem-bundle",
    platform: "cma",
    topics: ["parts"],
    title: "CMA XC40: ТО-1 — OEM фильтры 32140029",
    summary:
      "Первое ТО: Ravenol 0W-20, масляный 32140029, воздух 32146443, салон 31497285, кольцо 977751. На XC40 бывают два размера масляного фильтра.",
    body: "## Суть\n\nТО-1 на **XC40**.\n\n## PN\n\n- **32140029** / **32146443** / **31497285** / **977751**\n\n## Важно\n\nДва размера отверстия масляного фильтра — сверяйте по VIN/Skandix.",
    url: "https://www.drive2.ru/l/607393863757223421/",
  },
  {
    slug: "cma-to60k-oil-filter",
    platform: "cma",
    topics: ["parts"],
    title: "CMA XC40: ТО ~60 ткм — 32140029 / HU8014Z",
    summary:
      "На пробеге ~60 ткм меняют масло и масляный: OEM 32140029 или аналог MANN HU8014Z; иногда совмещают с передними колодками.",
    body: "## Суть\n\nСреднее ТО **XC40**.\n\n## PN\n\n- OEM **32140029**\n- Mann **HU8014Z**\n\n## Важно\n\nНе все кроссы взаимозаменяемы по посадочному диаметру.",
    url: "https://www.drive2.ru/l/652830082263426135/",
  },
  {
    slug: "cma-to8-spark-turbo-valve",
    platform: "cma",
    topics: ["parts"],
    title: "CMA XC40: ТО-8 — свечи и клапан турбо",
    summary:
      "К стандартным фильтрам добавляют свечи и электромагнитный клапан управления турбо; воздух меняют сами.",
    body: "## Суть\n\nРасширенное ТО на **XC40** 2.0.\n\n## Практика\n\nСвечи по состоянию; клапан турбо — по ошибкам/тяги.\n\n## Важно\n\nСверяйте PN свечей по мотору 2.0 vs 1.5.",
    url: "https://www.drive2.ru/l/700727282670524166/",
  },
  {
    slug: "cma-wiper-rubbers-alca",
    platform: "cma",
    topics: ["parts"],
    title: "CMA XC40: замена резинок дворников ALCA 120280",
    summary:
      "Вместо полных щёток меняют резинки ALCA 120280 (2×70 см). Крепление как у XC90; профиль паза должен совпасть.",
    body: "## Суть\n\nЭкономия на дворниках **XC40**: только резинки.\n\n## PN\n\n- Резинки ALCA **120280**\n\n## Практика\n\nСнять торцевые крышки, вытянуть ленту, новый профиль — в паз. Зимой часто ставят цельные ALCA.\n\n## Важно\n\nНеверный профиль = люфт и скрип.",
    url: "https://www.drive2.ru/l/699375433124170979/",
  },
  {
    slug: "p2-alternator-bearings-ps-seal",
    platform: "p2",
    topics: ["parts"],
    title: "P2 S60: подшипники генератора + сальник ГУР",
    summary:
      "Генератор снимают вверх после вентилятора; попутно меняют сальник насоса ГУР (течь «рекой»).",
    body: "## Суть\n\nРемонт генератора и насоса ГУР на **S60 P2**.\n\n## Практика\n\nКлемма АКБ → вентилятор → ремень → насос ГУР → генератор вверх. Сальник ГУР — 4 болта Torx.\n\n## Важно\n\nПосле — прокачка ГУР без воздуха.",
    url: "https://www.drive2.ru/l/9469974/",
  },
  {
    slug: "p2-lambda-denso-dox",
    platform: "p2",
    topics: ["parts"],
    title: "P2 S60: лямбда Denso — DOX-0410/0412/1419",
    summary:
      "На B5244S три варианта регулирующего зонда по VIN/шасси: DOX-0410, DOX-0412, DOX-1419. Путаница OEM частая.",
    body: "## Суть\n\nПодбор лямбды на **S60 P2** 2.4 атмо.\n\n## Ориентиры\n\n- DOX-0410 / OEM **8627599** (рынок USA / S6)\n- DOX-0412 / **8658237** (шасси от ~235108)\n- DOX-1419 / **9497252** (шасси до ~235107)\n\n## Важно\n\nТолько VIN + длина кабеля.",
    url: "https://www.drive2.ru/l/674080343493444013/",
  },

  // ——— SPA (12) ———
  {
    slug: "spa-fluids-xc60ii-full",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC60 II: масла и фильтры на 120 ткм",
    summary:
      "Liqui Moly 0W-20, HU8014Z, C29021, CUK34003, топливный 32312226, ATF 31492173, Haldex 32240904, редуктор 32240903.",
    body: "## Суть\n\nПолный жидкостный сервис **XC60 II**.\n\n## PN\n\n- Масляный **HU8014Z**\n- Воздух **C29021**\n- Салон **CUK34003**\n- Топливный **32312226**\n- Haldex **32240904**\n\n## Важно\n\nОбъёмы — по процедуре слива/залива.",
    url: "https://www.drive2.ru/l/703203932612090105/",
  },
  {
    slug: "spa-xc60ii-service-brakes-plugs",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC60 II: свечи ZXE24HLR7 и колодки 32373124",
    summary:
      "Большое ТО: фильтр 32140029, воздух 31370089, салон CUK34003, свечи ZXE24HLR7, перед 32373124 / диск 31471752.",
    body: "## Суть\n\nСервисный пакет **XC60 II**.\n\n## PN\n\n- Свечи **ZXE24HLR7**\n- Колодки перед **32373124**\n- Диск перед **31471752**\n- Зад ориентир **32379535**\n\n## ATF\n\nЧасто вместе: Toyota WS **0888602305**, кольца маслоохладителя **31437023**, ТЖ **32214958**.\n\n## Важно\n\n17″/18″ диски — разные PN.",
    url: "https://www.drive2.ru/l/685826151335085261/",
  },
  {
    slug: "spa-s90-brakes-plugs",
    platform: "spa",
    topics: ["parts"],
    title: "SPA S90: колодки ATE и свечи 32290011",
    summary:
      "Перед/зад ATE 13.0460-7377.2 / 7326.2, свечи Volvo 32290011, ТЖ 32214958.",
    body: "## Суть\n\nТормоза + свечи на **S90**.\n\n## PN\n\n- Свечи **32290011**\n- ATE перед **13.0460-7377.2**, зад **13.0460-7326.2**\n- ТЖ **32214958**\n\n## Важно\n\nСкобы колодок — смотрите комплектацию.",
    url: "https://www.drive2.ru/l/721561103871515374/",
  },
  {
    slug: "spa-wipers-xc90-df076",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC90: дворники DENSO DF-076",
    summary:
      "Сервисный режим щёток с экрана, перед DENSO DF-076, зад OEM 31349857.",
    body: "## Суть\n\nЗамена щёток на **XC90 II**.\n\n## PN\n\n- Перед **DENSO DF-076**\n- Зад **31349857**\n\n## Практика\n\nСервисный режим → кнопка на креплении.",
    url: "https://www.drive2.ru/l/588799197986183266/",
  },
  {
    slug: "spa-fuel-filter-s90-kl1055",
    platform: "spa",
    topics: ["parts"],
    title: "SPA S90 T5: топливный Mahle KL1055",
    summary:
      "Топливный под днищем: Mahle KL1055; рядом Filtron AP180/4 и K1384A. Фишки под давлением.",
    body: "## Суть\n\nЗамена топливного на **S90**.\n\n## PN\n\n- **Mahle KL1055**\n- Воздух Filtron **AP180/4**\n- Салон **K1384A**\n\n## Важно\n\nСбросьте давление / ловите бензин.",
    url: "https://www.drive2.ru/l/678179597719717353/",
  },
  {
    slug: "spa-s90-to-oem-filters",
    platform: "spa",
    topics: ["parts"],
    title: "SPA S90: ТО — OEM 32140029 / 31370089 / 31673604",
    summary:
      "На ~110 ткм: масляный 32140029, топливный 32242191, салон 31407748, воздух 31370089, свечи 31673604.",
    body: "## Суть\n\nOEM-набор ТО для **S90 II**.\n\n## PN\n\n- **32140029** / **32242191** / **31407748** / **31370089**\n- Свечи **31673604**\n\n## Практика\n\nСвечи под углом — тонкий ключ на 14, чистые колодцы.",
    url: "https://www.drive2.ru/l/671064383098479556/",
  },
  {
    slug: "spa-xc90-to60-filters",
    platform: "spa",
    topics: ["parts"],
    title: "SPA XC90 II: ТО ~60 ткм — 32140029 / KL1055",
    summary:
      "Масляный Volvo 32140029, топливный Mahle KL1055, сброс сервиса через V-tool; свечи проверяют на каждом ТО.",
    body: "## Суть\n\nСреднее ТО **XC90 II**.\n\n## PN\n\n- Масляный **32140029**\n- Топливный **KL1055**\n\n## Важно\n\nОбъём залива ~5,5 л — ориентир, сверяйте щуп/датчик.",
    url: "https://www.drive2.ru/l/696355074682660374/",
  },
  {
    slug: "spa-s60iii-brakes-brembo",
    platform: "spa",
    topics: ["parts"],
    title: "SPA S60 III: тормоза 345/320 Brembo + ТО",
    summary:
      "Диски Brembo 09C93611 / 09C93811, колодки P86029 / P86027; масло Wolf 0W-20, Filtron OE6624, ТЖ TRW PFB401SE.",
    body: "## Суть\n\nТО + тормоза на **S60 III** (SPA).\n\n## PN\n\n- Перед диск **09C93611**, колодки **P86029**\n- Зад **09C93811** / **P86027**\n- Масляный Filtron **OE6624**\n\n## Важно\n\n345/320 мм — не единственный размер на S60 III.",
    url: "https://www.drive2.ru/l/692113983456426662/",
  },
  {
    slug: "spa-v90-first-to-hengst",
    platform: "spa",
    topics: ["parts"],
    title: "SPA V90 CC: первое ТО — Hengst + 0W-20",
    summary:
      "После покупки V90 CC: фильтры Hengst, салон Mann, Liqui Moly Special Tec V 0W-20; задние тормоза изнашиваются быстрее из‑за EPB.",
    body: "## Суть\n\nПервое ТО после покупки **V90 Cross Country**.\n\n## Практика\n\nМасло чаще фильтров; задние диски — зона внимания из‑за электронного ручника.\n\n## Важно\n\nVIN важнее «как у продавца».",
    url: "https://www.drive2.ru/l/690624969834498321/",
  },
  {
    slug: "p3-transfer-case-seals",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC70: сальники угловой + патрубки турбо",
    summary:
      "Сервис угловой: сальники Corteco, сапун 30681138, втулка LR002746, сальник КВ 31293007; часто вместе с силиконовыми патрубками интеркулера.",
    body: "## Суть\n\nТечи угловой передачи и патрубков наддува на **XC70 III**.\n\n## PN\n\n- Сальник КВ **31293007**\n- Сапун угловой **30681138**\n- Сальники Corteco **19035438B** / **49357901**\n\n## Важно\n\nПосле разборки — уровень АКПП и мойка агрегатов от масла.",
    url: "https://www.drive2.ru/l/673005570877306394/",
  },
  {
    slug: "p3-atf-seal-battery-to",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC70: сальник АКПП + АКБ на ТО",
    summary:
      "На ТО XC70 III часто совмещают замену сальника привода АКПП и АКБ (Webasto зимой убивает батарею).",
    body: "## Суть\n\nТО + сальник привода + АКБ на **XC70 D5**.\n\n## Практика\n\nПосле Webasto утром «еле крутит» — сначала замер/заряд, затем замена. Сальник левого привода — типичная течь.\n\n## Важно\n\nТок утечки меряйте после засыпания модулей (~30–60 мин).",
    url: "https://www.drive2.ru/l/633116113655332909/",
  },
  {
    slug: "p3-belts-dayco-service",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC70: ремни 31330870 / 31325042 + ролики",
    summary:
      "На обслуживании: топливный PU9003Z, воздух C35177, масло HU7198Y, ремень генератора 31330870, кондёра 31325042, ролики Dayco APV2740 / OEM 31258133.",
    body: "## Суть\n\nРемни и фильтры на **XC70 III**.\n\n## PN\n\n- Ремень генератора **31330870**\n- Ремень кондиционера **31325042**\n- Ролик Dayco **APV2740**\n- Ролик/шкив **31258133**\n\n## Важно\n\nАКБ перед зимой — отдельный пункт чеклиста.",
    url: "https://www.drive2.ru/l/640733805090466316/",
  },
  {
    slug: "p3-battery-cover-acom",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC60: АКБ высокий + крышка и сброс счётчика",
    summary:
      "Ставят высокий Аком 100 А·ч и крышку; после замены обучают стеклоподъёмники и сбрасывают счётчик АКБ кнопками (ближний + ПТФ + аварійка).",
    body: "## Суть\n\nЗамена АКБ на **XC60 P3** без VIDA.\n\n## Практика\n\nМинус → BMS-провод → вентиляция газов → новая крышка под высокий корпус. Сброс счётчика комбинацией кнопок из БЖ.\n\n## Важно\n\nПосле — обучение стеклоподъёмников.",
    url: "https://www.drive2.ru/l/688939418509130712/",
  },
  {
    slug: "p2-o2-sensor-denso-0402",
    platform: "p2",
    topics: ["parts"],
    title: "P2 S60: задняя лямбда OEM 30622252 → Denso DOX-0402",
    summary:
      "Check Engine по заднему подогреваемому зонду: OEM 30622252, популярный аналог Denso DOX-0402.",
    body: "## Суть\n\nЗадняя лямбда на **S60 P2**.\n\n## PN\n\n- OEM **30622252**\n- Denso **DOX-0402**\n\n## Важно\n\nНа один год/шасси в каталоге несколько номеров — сверяйте EPC.",
    url: "https://www.drive2.ru/l/489020167032930430/",
  },
  {
    slug: "p3-atf-seal-trip-note",
    platform: "p3",
    topics: ["parts"],
    title: "P3 XC60: сальник привода АКПП после замены ATF",
    summary:
      "После замены масла АКПП часто всплывает течь сальника левого привода — меняют отдельно; температура АКПП на трассе с прицепом ~90 °C.",
    body: "## Суть\n\nСальник привода АКПП на **XC60 P3**.\n\n## Практика\n\nНе откладывайте сальник «на потом» при замене ATF — иначе снова на подъёмник.\n\n## Важно\n\nБренд ATF (Aisin/Cupper/Lukoil) в БЖ сравнивают по ощущениям — не как допуск.",
    url: "https://www.drive2.ru/l/615622608779481764/",
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
  let skippedUrl = 0;
  let skippedSlug = 0;
  const writtenSlugs = [];

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
      {
        seedSize: SEED.length,
        written,
        skippedUrl,
        skippedSlug,
        totalArticles: idx.articles.length,
        byPlatform: by,
        drive2UrlOwners: owners.size,
        dups,
        writtenSlugs,
      },
      null,
      2,
    ),
  );
}

main();
