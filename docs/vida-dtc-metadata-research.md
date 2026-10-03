# VIDA DTC Metadata Research

## What is confirmed now

- `scripts/extract_vida_dtc.py` already pulls DTC titles from `dbo.IE` + `dbo.IETitle`.
- The extractor is scoped to `fkInformationQualifier = 20`, which is labeled in VIDA as **«Диагностические коды неисправностей и связанные с ними процедуры»** (`06:02`).
- **Probe completed 2026-07-27** — see feature SPEC: `docs/ai/features/vida-servicerep-dtc-graph/SPEC.md`.

## Probe results (short)

### DiagSWDL

- IQ20 IEs: **54 435**
- `IEParentChildMap` from IQ20 parents: **75 755** edges (children often null-IQ procedure nodes)
- `FirstTestgrpId` set on **9 202** IEs
- `IEProfileMap` for IQ20: **~1.45M** rows (vehicle applicability)
- `Script` / `ScriptContent`: scanner protocols, not human repair text

### ServiceRep RU (`servicerep_ru-RU.MDF`, stage VIDA2013D)

- **86 621** `Document` rows; `XmlContent` = **ZIP** of one `*_ru-RU.xml`
- Qualifier 20 diagnostic docs: **19 160** (`condition` 10 224 + `test` 8 906)
- Section outline via `DocumentLinkTitle`: e.g. «Проверка» 12 860, «Информация по поиску неисправности» 14 516, «Замена компонента» 3 895

### Join (do not invent others)

```
IE (IQ=20, DTC title)
  → IEParentChildMap → child IE
  → Document.chronicleId = child.Id
    OR Document.projectDocumentId = child.ProjectDocumentId
```

- Direct root IE → Document: **~12%**
- Via children: **~86%** (sample 250)

## Commands

```bash
python scripts/extract_vida_dtc.py --probe-metadata --probe-only
python scripts/_probe_servicerep.py
python scripts/_probe_servicerep_deep.py
python scripts/_probe_join_xml.py
python scripts/_probe_child_join.py
```

Reports under `data/reports/servicerep-*.json` and `data/vida_dtc_metadata_probe.json`.

## Already shipped in app layer (not MDF graph)

- Detail API `/api/dtc/code/:code/details` exposes raw `dtc_entries` (true VIDA IE variants).
- Exact OBD lookup falls back to `obd_code`.
- UI «Подробнее» explains `вариантов: N` and surfaces `fault_state` parsed from titles.
- Deeper procedures: **SPEC written**, implementation not started — follow slices in the feature folder.
