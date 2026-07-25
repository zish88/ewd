# VIDA Resources EWD portal vs Capital runtime

Inventory of [vidaresources.volvocars.biz/ewd/Eng](https://vidaresources.volvocars.biz/ewd/Eng/index.html) and local Capital packages under `ewd_source/39363002`.

## Portal format (HTML TP books)

| Item | Detail |
|------|--------|
| Entry | `Eng/index.html` — model dropdown → publication dropdown |
| Catalog JS | `Eng/pdf-links.js` (`setOptions(chosen)`) |
| Artifact shape | Per TP folder: `index_*.html`, bookmarks, component dropdown HTML, sometimes `images/*.pdf` |
| ID scheme | e.g. `39161012` → FG 39 + serial + lang `01` + issue `1` preliminary / `2` definitive |
| Not provided | Capital `UID*.svg`, `Signals/connectivity*.zip`, FaceViews, `optionExpression` netlist |

**Conclusion:** portal books are a parallel dealer HTML/PDF channel. They cannot replace the Capital ETL used by this app ([`scripts/ewd_extract.py`](../scripts/ewd_extract.py), [`docs/vida-ewd-model.md`](vida-ewd-model.md)).

Raw parsed catalog (all models): [`_portal_pubs.json`](_portal_pubs.json).

## Portal models

C30, C30 Electric, S40 (04-), V40 (13-), V40 Cross Country, V50, S60 (-09), S60 (11-), S60 Cross Country, V60, V60 Cross Country, XC60, C70 (06-), V70 (-08), V70 (08-), XC70 (-08), XC70 (08-), S80 (-07), S80 (07-), S80L, XC90.

SPA2 / CMA (XC40, new XC60/90, etc.) are **not** on this portal.

## P3-relevant TP samples (latest on portal)

| Portal model | App matrix | Latest TP labels (from pdf-links.js) |
|--------------|------------|--------------------------------------|
| XC60 | XC60 | … `39260202 - 2013`, supplements through ~2014 HTML set |
| V70 (08-) | V70 | … `39271202` / shared P3 books (e.g. `39260202` multi-model) |
| XC70 (08-) | XC70 | same P3 book family as V70/S80 |
| S60 (11-) | S60 | `39187202` … later supplements |
| V60 | V60 | shared with S60 (11-) / XC60 books |
| S80 (07-) | S80 | P3 multi-model books |
| V40 (13-) | — not in UI | HTML + later `3936xxxx` links under `vida-prod…/All/` (often empty online) |

Example multi-model PDF: [TP39260202](https://vidaresources.volvocars.biz/ewd/Eng/39260202/images/39260202.pdf) — S60 (11-), V60, XC60, S80 (07-), V70 (08-), XC70.

## Local Capital scan (`39363002`)

Present on both `data/ewd/ewd_source/39363002` and `E:\manual\ewd_source\39363002` (`packages.xml`):

| Package | Name | SVG | Signals files | vehicleconfig focus |
|---------|------|-----|---------------|---------------------|
| **`1/2`** | `39363002` (main P3) | ~4546 | ~3429 | S60/S80/V60/V70/XC70/XC60 + SI6/T5/T6/D5/… |
| **`4/5`** | `39363002 (VEA)` | ~235 | ~331 | Drive-E only: `B4204TX`, `D4204TX` (+ AUTO/MAN), options `VEP4` / `VED4` |

`projects.xml` labels `4/5` as `VCCS_313BC_314A_VEA` (“New Engine Project”).

**Do not switch the whole site from `1/2` to `4/5`.** `4/5` is a small VEA add-on. Runtime stays on `1/2`; `4/5` is merged/added for Drive-E diagrams and option tokens.

## Gap matrix

| Need | Portal HTML | Capital `1/2` | Capital `4/5` |
|------|-------------|---------------|---------------|
| P3 body wiring UI (current app) | catalog only | **primary** | no |
| Drive-E 2.0 petrol/diesel sheets | no | partial / older | **yes (add)** |
| C30 / V40 / XC90 P1 books | yes (HTML) | no | no |
| SPA2 / CMA | no | no | no |

## Decision (this work)

1. Keep `EWD_SOURCE` / indexes rooted at **`1/2`**.
2. **Add** package **`4/5`**: path resolution + ETL merge + matrix tokens `VEP4` / `VED4` / `B4204TX` / `D4204TX`.
3. Portal stays documentation-only (no scrape into runtime).

### Applied wiring

```bash
EWD_PACKAGE_FOLDER=4/5 python scripts/ewd_extract.py --ewd-root data/ewd/ewd_source --out-dir data/ewd/_vea --connectivity-limit 0
python scripts/ewd/merge_indexes.py --primary data/ewd --secondary data/ewd/_vea
```

- UI: `2.0T Drive-E` / `2.0D Drive-E` on S60 / V60 / XC60 for `2014+` ([`server/vehicleMatrix.ts`](../server/vehicleMatrix.ts)).
- SVG resolve: [`server/ewdPaths.ts`](../server/ewdPaths.ts) also looks under `39363002/4/5`.
- Bundle: [`scripts/pack-ewd-bundle.mjs`](../scripts/pack-ewd-bundle.mjs) copies VEA Signals/SVG when present.
- Paths helper: [`scripts/ewd/paths.py`](../scripts/ewd/paths.py) (`EWD_PACKAGE_FOLDER`).
