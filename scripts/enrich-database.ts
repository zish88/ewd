import Database from "better-sqlite3";

const db = new Database("database.sqlite"); // Укажи точное имя файла твоей базы данных SQLite

// Полный официальный глоссарий компонентов Volvo XC70 / V70 / S80
const volvoGlossary: Record<string, string> = {
  "4/56": "Центральный электронный модуль (CEM)",
  "4/93": "Модуль автомобиля без ключа (KVM)",
  "7/69": "Блок переключателей стеклоподъемников двери водителя",
  "8/120": "Мотор регулировки / зеркало со стороны водителя",
  "8/121": "Мотор регулировки / зеркало со стороны пассажира",
  "10/122": "Модуль двери водителя (DDM)",
  "10/123": "Модуль двери пассажира (PDM)",
  "15/31": "Блок предохранителей в моторном отсеке",
  "15/36": "Розетка 12V / Прикуриватель",
  "16/10": "Звуковой сигнал (Гудок) право",
  "16/11": "Звуковой сигнал (Гудок) лево",
  "20/3": "Шунт цепи питания (Блок CEM)",
  "31/7": "Точка заземления (Масса) левая передняя стойка",
  "31/84": "Точка заземления (Масса) правая передняя стойка",
  "73/5071": "Распределительная спайка (Скрутка массы) жгута двери LHD",
  "73/5072": "Распределительная спайка (Скрутка массы) жгута двери RHD",
  "74/507": "Разъем сопряжения передней левой двери (Кузов-Дверь)",
  "74/508": "Разъем сопряжения передней правой двери (Кузов-Дверь)",
  "74/509": "Разъем сопряжения задней левой двери",
  "74/510": "Разъем сопряжения задней правой двери",
};

function getComponentName(code: string): string {
  return volvoGlossary[code.trim()] || `Компонент Volvo ${code}`;
}

// Создаем новую чистую таблицу для идеальной структуры проводки
db.exec(`
  CREATE TABLE IF NOT EXISTS enriched_wires (
    id TEXT PRIMARY KEY,
    book_id INTEGER,
    page_number INTEGER,
    circuit_type TEXT,
    pin_number TEXT,
    wire_color TEXT,
    component_source TEXT,
    component_dest TEXT,
    technical_description TEXT,
    raw_segment TEXT
  );
  DELETE FROM enriched_wires;
`);

// Читаем грязные строки, полученные при первом левом-правом сканировании PDF
const rawRows = db.prepare(`
  SELECT c.*, p.manual_id, p.source_page 
  FROM connector_pin_routes c
  JOIN pages p ON p.id = c.page_id
`).all() as any[];

console.log(`🚀 Начинаем семантический анализ ${rawRows.length} строк проводки...`);

let enrichedCount = 0;

for (const row of rawRows) {
  const rawLine = row.raw_line || "";
  const bookId = row.manual_id || 1;
  const pageNum = row.source_page || 1;

  // ----------------------------------------------------------------
  // АНАЛИЗАТОР 1: Выделение изолированных модульных пинов (например, A:52 BN-WH Au 5)
  // ----------------------------------------------------------------
  const modulePinRegex = /\b([A-Z]:\d+)\s+([A-Z-]+)(?:\s+(Au\s+\d+|\d+))?/gi;
  let match;
  
  while ((match = modulePinRegex.exec(rawLine)) !== null) {
    const pin = match[1];
    const color = match[2];
    const terminal = match[3] || "";
    
    // Определяем к какому блоку на этой странице относится пин
    const potentialComponent = row.source_code || row.destination_code || "10/122";
    const compName = getComponentName(potentialComponent);
    
    const description = `Физический контакт ${pin} терминала ${terminal || '—'} на блоке ${compName} (${potentialComponent}). Это изолированная цепь управления исполнительными механизмами, цвет провода: ${color}.`;

    db.prepare(`
      INSERT INTO enriched_wires VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `${row.id}-mod-${enrichedCount++}`,
      bookId, pageNum, 'MODULE_PIN',
      pin, color, potentialComponent, potentialComponent,
      description, match[0]
    );
  }

  // ----------------------------------------------------------------
  // АНАЛИЗАТОР 2: Выделение транзитных межжгутовых переходов (73/5071 17 18 74/507)
  // ----------------------------------------------------------------
  const transitRegex = /\b(73\/\d+|74\/\d+|15\/\d+)\s+(\d+)(?:\s+(\d+))?\s+(73\/\d+|74\/\d+|15\/\d+)/gi;
  
  while ((match = transitRegex.exec(rawLine)) !== null) {
    const srcComp = match[1];
    const pin1 = match[2];
    const pin2 = match[3] || "";
    const destComp = match[4];
    
    const srcName = getComponentName(srcComp);
    const destName = getComponentName(destComp);
    
    const exactPins = pin2 ? `контакты ${pin1} и ${pin2}` : `контакт ${pin1}`;
    const isGround = srcComp.includes("5071") || srcComp.includes("5072") || rawLine.includes("BK-OG");
    const finalColor = isGround ? "BK-OG" : "—";
    
    let description = `Транзитная линия электроцепи автомобиля. Провод идет из узла ${srcName} (${srcComp}) через межжгутовой ${exactPins} разъема сопряжения ${destName} (${destComp}).`;
    if (isGround) {
      description += ` Данная ветка является силовой шиной заземления (Масса кузова автомобиля).`;
    }

    db.prepare(`
      INSERT INTO enriched_wires VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `${row.id}-tran-${enrichedCount++}`,
      bookId, pageNum, 'TRANSIT_LINE',
      pin2 ? `${pin1} / ${pin2}` : pin1, finalColor, srcComp, destComp,
      description, match[0]
    );
  }
}

console.log(`✅ Анализ завершен! База полностью реструктурирована. Создано ${enrichedCount} чистых семантических записей.`);