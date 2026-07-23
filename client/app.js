const form = document.querySelector("#search-form");
const results = document.querySelector("#results");
const status = document.querySelector("#status");
const template = document.querySelector("#card");
const wireFinderForm = document.querySelector("#wire-finder-form");
const wireResults = document.querySelector("#wire-results");
const locationResults = document.querySelector("#location-results");
const vehicleYear = document.querySelector("#vehicle-year");
const vehicleEngine = document.querySelector("#vehicle-engine");
const NOVICE_ALIASES = {
  "гудок": "Horn (16/10, 16/11)",
  "сигнал": "Horn (16/10, 16/11)",
  "прикуриватель": "Outlet 12 V",
  "подсветка дверей": "Interior lighting",
  "ноги": "Interior lighting",
  "вентилятор": "Passenger compartment fan",
};

function vehicleFilters() {
  return { year: vehicleYear.value, engine: vehicleEngine.value };
}

function clearInactiveResults(activeMode) {
  if (activeMode !== "search") {
    results.replaceChildren();
    status.textContent = "";
  }
  if (activeMode !== "wire") wireResults.replaceChildren();
  if (activeMode !== "location") locationResults.replaceChildren();
}

document.querySelectorAll("[data-query]").forEach((button) => button.addEventListener("click", () => {
  form.q.value = button.dataset.query;
  form.requestSubmit();
}));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const recognised = NOVICE_ALIASES[form.q.value.trim().toLowerCase()];
  clearInactiveResults("search");
  status.textContent = recognised ? `Распознано: ${recognised}. Ищем в руководстве…` : "Ищем в руководстве…";
  results.replaceChildren();
  try {
    const response = await fetch(`/api/search?${new URLSearchParams({ ...Object.fromEntries(new FormData(form)), ...vehicleFilters() })}`);
    const data = await response.json();
    status.textContent = data.results.length
      ? `Найдено: ${data.results.length}. ${data.notice}`
      : "Совпадений нет. Проверьте написание или импортируйте PDF.";
    for (const item of data.results) {
      const card = template.content.cloneNode(true);
      card.querySelector("strong").textContent = item.value || "Страница схемы";
      card.querySelector(".result-heading span").textContent = `PDF стр. ${item.sourcePage}`;
      card.querySelector(".meta").textContent = [item.type, item.systemName, `уверенность ${Math.round((item.confidence || 0) * 100)}%`].filter(Boolean).join(" · ");
      card.querySelector(".excerpt").textContent = item.excerpt;
      const endpoints = item.connections?.map((connection) => `${connection.type}: ${connection.value}`).join(" → ") || "На этой странице не извлечены узлы цепи.";
      card.querySelector(".details").textContent = `Связанные узлы на схеме: ${endpoints}. Источник: ${item.source.title}, редакция ${item.source.revision}. Страница ${item.sourcePage}.`;
      card.querySelector(".pdf-link").href = `/api/manual#page=${item.sourcePage}`;
      results.append(card);
    }
  } catch (error) {
    status.textContent = `Ошибка поиска: ${error.message}`;
  }
});

wireFinderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearInactiveResults("wire");
  wireResults.textContent = "Подбираем возможные цепи…";
  try {
    const response = await fetch(`/api/search/wire-finder?${new URLSearchParams({ ...Object.fromEntries(new FormData(wireFinderForm)), ...vehicleFilters() })}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось определить цепи.");
    wireResults.replaceChildren();
    if (!data.results.length) {
      wireResults.textContent = "Подходящих цепей не найдено. Попробуйте соседнее место жгута или двойной цвет провода.";
      return;
    }
    for (const item of data.results) {
      const itemElement = document.createElement("article");
      itemElement.className = "wire-result";
      const title = document.createElement("strong");
      title.textContent = `PDF стр. ${item.sourcePage}: ${item.function}`;
      const route = document.createElement("p");
      route.textContent = `Откуда: ${item.from} → Куда: ${item.to}`;
      const excerpt = document.createElement("p");
      excerpt.textContent = item.excerpt;
      const link = document.createElement("a");
      link.target = "_blank";
      link.rel = "noreferrer";
      link.href = `/api/manual#page=${item.sourcePage}`;
      link.textContent = "Открыть схему";
      itemElement.append(title, route, excerpt, link);
      wireResults.append(itemElement);
    }
  } catch (error) {
    wireResults.textContent = `Ошибка определителя: ${error.message}`;
  }
});

const COLOR_PALETTE = {
  RD: "#dc2626", BK: "#141414", SB: "#141414", GN: "#16a34a", WH: "#f8fafc",
  BN: "#854d0e", VT: "#9333ea", YE: "#eab308", BU: "#2563eb", BL: "#2563eb",
  GY: "#6b7280", GR: "#6b7280", OR: "#ea580c",
};

function insulationStyle(color) {
  const [primary, stripe] = color.split("-");
  const first = COLOR_PALETTE[primary] || "#334155";
  if (!stripe) return first;
  const second = COLOR_PALETTE[stripe] || "#f8fafc";
  return `repeating-linear-gradient(135deg, ${first} 0 14px, ${second} 14px 20px)`;
}

document.querySelectorAll("[data-location]").forEach((button) => button.addEventListener("click", async () => {
  clearInactiveResults("location");
  locationResults.textContent = "Загружаем провода выбранного разъёма…";
  try {
    const response = await fetch(`/api/location/${button.dataset.location}?${new URLSearchParams(vehicleFilters())}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить зону.");
    locationResults.replaceChildren();
    const title = document.createElement("p");
    title.className = "location-title";
    title.textContent = `${data.location.label} · главный разъём ${data.location.connector}`;
    locationResults.append(title);
    if (!data.wires.length) {
      const empty = document.createElement("p");
      empty.textContent = "На указанных страницах не найдены извлечённые провода. Откройте исходную схему и повторно импортируйте PDF после обновления парсера.";
      locationResults.append(empty);
      return;
    }
    for (const wire of data.wires) {
      const item = document.createElement("article");
      item.className = "location-wire";
      const color = document.createElement("div");
      color.className = "insulation";
      color.style.background = insulationStyle(wire.color);
      color.textContent = wire.color;
      const description = document.createElement("div");
      const pin = document.createElement("strong");
      pin.textContent = `Пин ${wire.pin}`;
      const functionText = document.createElement("p");
      functionText.textContent = `Функция: ${wire.function}`;
      const sourceText = document.createElement("p");
      sourceText.textContent = `Откуда: ${wire.source || wire.connector}`;
      const destination = document.createElement("p");
      destination.textContent = `Куда направляется: ${wire.destination}`;
      const source = document.createElement("a");
      source.target = "_blank";
      source.rel = "noreferrer";
      source.href = `/api/manual#page=${wire.sourcePage}`;
      source.textContent = `Схема, стр. ${wire.sourcePage}`;
      description.append(pin, functionText, sourceText, destination, source);
      item.append(color, description);
      locationResults.append(item);
    }
  } catch (error) {
    locationResults.textContent = `Ошибка поиска по расположению: ${error.message}`;
  }
}));
