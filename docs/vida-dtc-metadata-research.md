# VIDA DTC Metadata Research

## What is confirmed now

- `scripts/extract_vida_dtc.py` already pulls DTC titles from `dbo.IE` + `dbo.IETitle`.
- The extractor is scoped to `fkInformationQualifier = 20`, which is labeled in code as `Diagnostic Trouble Codes and Associated Procedures`.
- The checked-in scan sample `data/vida_dtc_scan_sample.txt` contains the token `DTCApplScript`, so the DiagSWDL source almost certainly has deeper DTC applicability metadata beyond the short title rows.

## New probe command

Use the extractor in probe mode against the DiagSWDL MDF:

```bash
python scripts/extract_vida_dtc.py --probe-metadata --probe-only
```

Optional output override:

```bash
python scripts/extract_vida_dtc.py --probe-metadata --probe-only --probe-out data/vida_dtc_metadata_probe.json
```

The probe writes a JSON report with:

- `iq20_ie_count`: how many `IE` rows are under DTC qualifier `20`
- `candidate_tables`: tables whose names or column names look related to DTC metadata
- full column lists for each candidate table so the next pass can map joins instead of searching blind

## What to look for in the probe

Prioritize candidate tables/columns with these patterns:

- `DTC`, `Appl`, `Script`
- `Procedure`, `Check`, `Cause`, `Symptom`
- `fkIE`, `fkInformationQualifier`
- title/text tables adjacent to those entities

## Recommended next pass

1. Run the probe on the real DiagSWDL MDF and open `data/vida_dtc_metadata_probe.json`.
2. Start from candidate tables that either reference `fkIE` directly or sit next to `DTCApplScript`.
3. For one known multi-variant code such as `ECM-6661`, trace which `IE.Id` rows connect to applicability/procedure tables.
4. Only after the join path is clear, extend `dtc.sqlite` with structured fields for procedures/applicability/causes.

## Already shipped in app layer (not MDF graph)

- Detail API `/api/dtc/code/:code/details` exposes raw `dtc_entries` (true VIDA IE variants).
- Exact OBD lookup falls back to `obd_code`.
- UI «Подробнее» explains `вариантов: N` and surfaces `fault_state` parsed from titles.
- Deeper procedures/applicability/causes remain blocked on the MDF probe above — do not invent joins without the probe report.
