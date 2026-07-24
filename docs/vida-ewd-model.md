# VIDA / Capital EWD — модель связей

Внутренняя knowledge base: как дилерское ПО связывает узлы, пины, провода и листы схем, и как это зеркалируется в нашем сайте.

## 1. Два источника, один Volvo-код

| Источник | Путь / артефакт | Что даёт |
|----------|-----------------|----------|
| **VIDA SQL (MDF)** | EPC, ImageRepo, DiagSWDL | RU-имена, part number, DTC-тексты |
| **Capital / CHS `39363002`** | `data/ewd/ewd_source/39363002/1/2/` (зеркало `E:\manual\ewd_source\…`) | Системы, SVG, netlist, опции VIN |

Стык — **Volvo code** вида `FAMILY/ID` (`3/74`, `74/507`). Геометрия и netlist живут только в Capital; EPC только подписывает код.

**Источник истины для полостей и подсветки:** FaceViews HTML + `Signals/connectivity*.zip` (+ `pin_wire_index`).  
**PDF (`Электросхемы XC70.pdf`) deprecated** — не используется в runtime, ETL и UI.

Наш ETL:

- MDF → [`scripts/vida_extractor.py`](../scripts/vida_extractor.py), [`scripts/extract_vida_dtc.py`](../scripts/extract_vida_dtc.py)
- Capital → [`scripts/ewd_extract.py`](../scripts/ewd_extract.py) → `data/ewd/*.json` (devices, svg_desc, connectivity, pin_wire, **face_view**, **location**, lang_ru)
- SQLite → [`scripts/ewd/assemble_capital_db.py`](../scripts/ewd/assemble_capital_db.py) → `data/wiring.sqlite` (без PDF)

## 2. Канонические сущности

```
VolvoCode ──< ObjectOccurrence (objectId, systemUid, diagramUids[], optionExpression)
                 │
                 ├── SystemDesign (systemUid = папка UID…/)
                 │      └── DiagramSheet (diagramUid = UID….svg)
                 │             └── DescGroup (schemClass + uids[] → SVG paths)
                 │
                 └── ConnectivityFile (Signals/connectivityN.zip)
                        ├── Device/Connector → Pin (PPIN, sourceObjectUID)
                        └── Wire (wirecolor, wirecsa, harness, sourceObjectUID,
                                  sharedObjectUID, optionExpression)
```

| Поле | Смысл |
|------|--------|
| `objectId` / `sourceObjectUID` | Логический объект Capital; тот же UID лежит в SVG `<desc>` |
| `systemUid` / `sourceDesignUID` / `designFolder` | LogicDesign = папка с листами |
| `diagramUid` | Один лист схемы (stem SVG) |
| `wire.sourceObjectUID` | Объект **проводника** — то, что VIDA красит |
| `pin.sourceObjectUID` | Объект **контакта** — якорь маркера пина |
| `sharedObjectUID` | Связь экземпляра провода между системами (signal tracer) |
| `optionExpression` | Capital boolean по опциям автомобиля (`Y285 && AUTO`, `EXEC`, …) |
| `harness` | Физический жгут (числовой id, напр. `14014`) |

Образец netlist: [`data/ewd/connectivity_samples/connectivity1.json`](../data/ewd/connectivity_samples/connectivity1.json).

## 3. Сценарий навигации «как VIDA»

1. Пользователь выбирает VIN / модель → токены опций (`Y285`, `3.2P`, `AUTO`, …).
2. Выбирает Volvo code (или кликает объект на схеме).
3. Capital открывает **систему** (`systemUid`) и **лист** (`diagramUid`), где есть `objectId`.
4. Related Data показывает devices / connectors / signals для объекта.
5. Клик по пину/проводу → читается `Signals/connectivity*.zip` (или Full Instance).
6. Для каждого matched wire берутся `pin.sourceObjectUID` + `wire.sourceObjectUID`.
7. На SVG подсвечиваются `<g>` с этими UID в `<desc>` (`CAFConductor`, `CAFPinList`).
8. Signal Tracer: `objectData.getSignalTraceFiles()` → файл в `Signals/` + набор UID из `GlobalSignals/globalsignal*.xml`; `HIGHLIGHT_OBJECT_ACROSS_WINDOWS` красит тот же `objectId` на других листах.

## 4. Файлы пакета `39363002/1/2`

Корень данных в репозитории: `data/ewd/ewd_source/39363002/1/2/` (полная копия с `E:\manual\ewd_source\39363002\1\2`). EPC/ImageRepo — в `data/ewd/`; PDF не входит в прод-путь.

| Файл / папка | Роль |
|--------------|------|
| `index.xml` | Дерево навигации |
| `diagramAsSystem.xml` | LogicDesign → имя, folders, diagram ids |
| `devices.xml`, `connectors.xml`, `inlines.xml`, `splices.xml`, `grounds.xml` | Каталоги объектов |
| `LocationViews.xml` + `Resources/TwoDviews/` | 2D расположение узлов |
| `UID*/FaceViews/*.html` | Таблица полостей: span id UID → pinUid |
| `langdictionary.xml` | RU-имена кодов |
| `Introduction/*_RU.html`, `Resources/{Fuse,Inline,Splice}Report}.html` | Справка / отчёты |
| `vehicleconfig.xml`, `vinOptions.xml` | Опции / конфигурация |
| `UID<system>/UID<diagram>.svg` | Листы схем |
| `UID<system>/O/<objectId>.xml` | Детали объекта (в т.ч. signalTraceFiles) |
| `Signals/connectivity*.zip` | Gzip-XML netlist (не настоящий zip) |
| `Signals/gstIdentifier.xml` | Лицензия / наличие Ground Signal Tracer |
| `GlobalSignals/globalsignal*.xml` | Наборы UID одного сквозного сигнала |
| `UID*/Reports/Wire List.html` | HTML wire list по системе |

## 5. Reverse-engineering Capital JS (пакет `scripts/`)

### Signal Tracer — `models/signalTracerModel.js`

- `updateData(systemId, objectId)` → `objectDataLoader.load` → `getSignalTraceFiles()`.
- Файлы: `signalTraceFile` («Signal Path») и `fullInstanceFile` («Full Instance»).
- `render()` → `displayConnectivity(path, popOut, flush, title, connectivityUID, designID)`.
- Лицензия проверяется наличием `GlobalSignals/globalsignal0.xml` / `globalsignal1.xml`.
- Ground tracer — наличием `Signals/gstIdentifier.xml`.
- Подсветка между окнами: событие `HIGHLIGHT_OBJECT_ACROSS_WINDOWS` с `{ objectId, systemId }`.

### Render connectivity — `RenderConnectivity.js`

- Корень netlist: `{projectId}/Signals/` + имя файла.
- В рендер передаются: путь файла, **текущая конфигурация автомобиля** (`getCurrentConfigurationData()`), `connectivityUID`, `isFullInstance`, `designID`.
- Конфигурация фильтрует ветки с `optionExpression` до отрисовки.

### Related Data — `collections/popover/relatedData/*`

- `SignalsCollection` / `DevicesCollection` берут объекты через `data.getObjects(contentType)` + language filter.
- Это UI-панель «связанные устройства / сигналы» для выбранного объекта — не отдельная БД.

### Harness — `views/harness.js` + `collections/harnesses.js`

- Список жгутов; клик → `fileDisplayHandler.display` с `contentType.HARNESS`.
- Pop-out: `#/showHarness/{name}/{packageId}`.

### GlobalSignals XML

```xml
<objects>
  <object id="UID…"/>
  <object id="UID…"/>
</objects>
```

Все UID в одном `globalsignalN.xml` — один сквозной сигнал. Наш `/api/ewd/trace` строит обратный индекс UID → siblings → листы SVG.

## 6. Как это реализовано у нас

| Шаг VIDA | Наш API / модуль |
|----------|------------------|
| Code → systems / sheets | `GET /api/ewd/diagrams`, `GET /api/ewd/systems` |
| Netlist endpoints | `GET /api/ewd/endpoints` (+ `pin_wire_index`) |
| Highlight pin + wire | `GET /api/ewd/highlight` → `pinUids` + `wireUids` |
| Выбор листа по net | `GET /api/ewd/pick-diagram` (score: matched + on-sheet UIDs) |
| optionExpression | `evaluateOptionExpression` + `optionTokens` из VIN/matrix |
| Signal tracer | `GET /api/ewd/trace?uid=` / `?code=` |
| RU names / PN | `wiring.sqlite` ← VIDA EPC extract |

### Индексы в `data/ewd/`

| Файл | Содержание |
|------|------------|
| `device_index.json` | code → objectIds, systemUids, diagramUids |
| `svg_desc_index.json` | diagramUid → groups[{schemClass,uids}], textCodes |
| `connectivity_index.json` | code → connectivity files (+ per systemUid) |
| `pin_wire_index.json` | code+PPIN+systemUid → pinUid, wireUid, peer, options, diagramUids |
| `global_signal_index.json` | uid → sibling UIDs + diagramUids (signal tracer) |

## 7. Правила «безошибочности»

1. **Красить провод по `wireUid`**, маркер пина — по `pinUid`. Не OCR цифры как единственный источник истины.
2. **Фильтровать `optionExpression`** токенами VIN/vehicle matrix; пустой expression = всегда true; без токенов автомобиля — не отбрасывать (показать все ветки).
3. **Скоупить по zone / diagramUid / systemUid** — никогда не отдавать unscoped dump при активном скоупе.
4. **Выбор листа** = max(pinUid ∪ wireUid ∪ peerUid ∩ sheet.desc.uids), затем семейные эвристики как soft fallback.
5. **Golden tests** фиксируют exact UID set для эталонных кодов.

## 8. Пересборка индексов

Всегда с in-repo корня (`data/ewd/ewd_source`), не с `E:\manual`:

```bash
python scripts/ewd_extract.py --ewd-root data/ewd/ewd_source --connectivity-limit 0
python scripts/ewd/assemble_capital_db.py
```

Health: `index.xml` + `Signals/` + `face_view_index.json` (не PDF).

Golden: `server/routes/ewd.golden.test.ts` — FaceView cavity → pinUid/wireUid → `/highlight` on-sheet для `74/507:21`, `4/83:1`.

## 9. Ограничения и следующий уровень

- Полный Java-applet Signal Renderer Capital не портируем; мы красим SVG path/groups по UID.
- Пакет `4/5` (VEA/Drive-E) — после стабилизации `1/2`.
- 3D location — только если появится вне TwoDviews.
- Harness id → zone map улучшит зонный скоуп сверх regex по имени системы.
