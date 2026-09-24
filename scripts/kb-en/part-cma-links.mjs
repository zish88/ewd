/** @type {Record<string, { title_en: string; summary_en: string; body_md_en: string }>} */
export const partCmaLinks = {
  "cma-battery-bms-xc40": {
    title_en: "CMA XC40: main battery replacement and BMS reset",
    summary_en:
      "On the XC40, after swapping the main battery (e.g. Exide ET720 sized like ET700), owners reset the BMS — otherwise the state-of-charge display lies and false faults can appear.",
    body_md_en:
      "## Summary\n\nOn the **XC40**, the battery is tied to the **BMS**. Swapping terminals alone is often not enough — you need a scan-tool reset/registration.\n\n## Procedure\n\n1. Match capacity/type to VIN (logs often compare ET700/ET720).\n2. Check battery date code.\n3. On D4 and similar: replace via the engine-bay compartment; reassemble.\n4. **BMS reset** with a scanner (VIDA / compatible tool).\n\n## Important\n\nBattery parameters only from VIN. Drive2 summary.",
  },
  "cma-brake-pads-xc40": {
    title_en: "CMA XC40: brake pads — front/rear PN",
    summary_en:
      "Front OEM is often 31471407; rear by VIN is often 32276934. Rear EPB needs a caliper wind-back procedure — do not squeeze the piston blindly.",
    body_md_en:
      "## Summary\n\nPad replacement on the **XC40** is routine, but the **rear EPB** needs diagnostics (wind/unwind the actuator).\n\n## Part numbers\n\n- Front (example): **31471407**\n- Rear (VIN example): **32276934**\n- Aftermarket: Zimmermann etc. — only after confirming 15″/16″ disc size\n\n## Procedure\n\nFront: standard swap. Rear: service parking-brake mode first, or you risk damaging EPB motors.\n\n## Important\n\nVerify against VIN. Drive2 summary.",
  },
  "cma-cabin-filter-access-xc40": {
    title_en: "CMA XC40: cabin filter location",
    summary_en:
      "XC40 cabin filter is behind the glove box or in the HVAC housing (year-dependent). Install to the airflow arrow; charcoal packs are denser.",
    body_md_en:
      "## Summary\n\nFilter replacement is basic CMA maintenance, but access varies by year.\n\n## Procedure\n\n1. Confirm location in the manual for your model year.\n2. Do not tear the duct cover seals.\n3. Airflow arrow — toward the blower / same as the old filter.\n\n## Important\n\nFilter PN and pack length — EPC only.",
  },
  "cma-cabin-filter-xc40": {
    title_en: "CMA XC40: cabin and engine air filters — PN",
    summary_en:
      "XC40 cabin filter is under the glove box; logs mention MANN CUK29010, BIG FILTER GB98106C, Filtron. Air filter e.g. Filtron AP180/2. Verify against VIN.",
    body_md_en:
      "## Summary\n\n**XC40 (CMA)** — easy service: cabin and engine air filters without a lift.\n\n## Part numbers (from owner logs)\n\n- Cabin: **MANN CUK29010**, **BIG FILTER GB98106C**, Filtron K1418 / K1418A — compare charcoal and density to OEM.\n- Air: **Filtron AP180/2** (and OEM crosses in EPC).\n- Oil drain plug ring (often on the same service): **977751**\n\n## Procedure\n\nCabin — under glove box / lower panel; mind the arrow direction. After replacement, run climate on recirc for a few minutes.\n\n## Important\n\nVerify against VIN. Drive2 summary, not a dealer catalog.",
  },
  "cma-filters-compare": {
    title_en: "CMA XC40: OEM vs Filtron — what to check",
    summary_en:
      "XC40 cabin/air filter comparison: Filtron air is often close to OEM; charcoal cabin may be less dense. Decide by VIN and cabin odor.",
    body_md_en:
      "## Summary\n\nOn the **XC40**, owners compare OEM and **Filtron**: air often matches; charcoal cabin aftermarket may be looser.\n\n## What to check\n\n- Pack height and end foam\n- Charcoal / odor after 1–2 weeks\n- EPC number, not “looks like the photo”\n\n## Important\n\nDrive2 experience, not a lab test. Verify PN.",
  },
  "cma-oil-filter-brakes-zimmermann": {
    title_en: "CMA XC40: service + Zimmermann brakes",
    summary_en:
      "Oil filter 32140029, air C24051/1, cabin CUK29010; discs 610.3725.20 / 610.3732.20, pads 26126.185.2 / 20510.175.2.",
    body_md_en:
      "## Summary\n\nFull service and brakes on **XC40** 2.0.\n\n## PN\n\n- Filter **32140029**\n- Zimmermann discs/pads as in summary\n\n## Important\n\n0W-20 oil — typical CMA spec.",
  },
  "cma-tmap-sensor-note": {
    title_en: "CMA: boost / TMAP fault — where to start",
    summary_en:
      "XC40 petrol boost pressure/temperature faults: intercooler hoses, clamp leaks, TMAP sensor. Do not assume the turbo is destroyed first.",
    body_md_en:
      "## Summary\n\nCMA boost is sensitive to **air leaks** after the turbo.\n\n## Checklist\n\n1. ECM codes (boost / TMAP).\n2. Intercooler hoses and clamps.\n3. Sensor connector, contamination.\n4. Turbo control valve (often on service lists).\n\n## Important\n\nAfter work — check adaptation and repeat codes on a test drive.",
  },
  "cma-to1-oem-bundle": {
    title_en: "CMA XC40: first service — OEM filters 32140029",
    summary_en:
      "First service: Ravenol 0W-20, oil filter 32140029, air 32146443, cabin 31497285, ring 977751. XC40 can have two oil filter sizes.",
    body_md_en:
      "## Summary\n\nFirst service on **XC40**.\n\n## PN\n\n- **32140029** / **32146443** / **31497285** / **977751**\n\n## Important\n\nTwo oil filter bore sizes — verify via VIN/Skandix.",
  },
  "cma-to2-oem-filters": {
    title_en: "CMA XC40: second service — OEM 32257032 / 32146443",
    summary_en:
      "Second service: oil 32257032 + 977751, fuel 31465948, cabin 31497285, air 32146443, oil 0W-20.",
    body_md_en:
      "## Summary\n\nOEM cheat sheet for **XC40**.\n\n## List\n\n- Oil **32257032** + **977751**\n- Fuel **31465948**\n- Cabin **31497285**\n- Air **32146443**\n\n## Important\n\n1.5T / B4 may differ.",
  },
  "cma-to60k-oil-filter": {
    title_en: "CMA XC40: ~60k km service — 32140029 / HU8014Z",
    summary_en:
      "Around 60k km: oil and filter — OEM 32140029 or MANN HU8014Z; sometimes combined with front pads.",
    body_md_en:
      "## Summary\n\nMid-interval service on **XC40**.\n\n## PN\n\n- OEM **32140029**\n- Mann **HU8014Z**\n\n## Important\n\nNot all crosses share the same mounting diameter.",
  },
  "cma-to8-spark-turbo-valve": {
    title_en: "CMA XC40: 8th service — spark plugs and turbo valve",
    summary_en:
      "Beyond standard filters: spark plugs and turbo control solenoid; owners often replace air filter themselves.",
    body_md_en:
      "## Summary\n\nExtended service on **XC40** 2.0.\n\n## Procedure\n\nSpark plugs by condition; turbo valve by faults/performance.\n\n## Important\n\nVerify spark PN for 2.0 vs 1.5 engine.",
  },
  "cma-wiper-rubbers-alca": {
    title_en: "CMA XC40: wiper refills ALCA 120280",
    summary_en:
      "Instead of full blades, refills ALCA 120280 (2×70 cm). Mount like XC90; groove profile must match.",
    body_md_en:
      "## Summary\n\nSave money on **XC40** wipers: refills only.\n\n## PN\n\n- ALCA refills **120280**\n\n## Procedure\n\nRemove end caps, pull the strip, slide new rubber into the groove. Many switch to full ALCA blades in winter.\n\n## Important\n\nWrong profile = play and squeak.",
  },
  "cma-wipers-xc40": {
    title_en: "CMA XC40: wiper blade replacement",
    summary_en:
      "XC40 blades release with a button on the arm; fronts often need service mode from the screen. Full blades or refills only.",
    body_md_en:
      "## Summary\n\nWiper swap on the **XC40** is simple: service position + release button on the blade.\n\n## Part numbers\n\n- Front: aftermarket refs like **DENSO DF-076** (check L/R length).\n- Rear OEM (log example): **31349857**\n- Refills only — match your frame type; ALCA kits appear in owner posts.\n\n## Procedure\n\n1. Wiper service mode (car menu — software-dependent).\n2. Press the square latch, slide the blade up.\n3. Do not bend the arm.\n\n## Important\n\nLeft/right lengths differ. Verify via VIN/catalog. Source: Drive2.",
  },
  "cma-xc40-12v-battery-access": {
    title_en: "CMA XC40: 12V access and BMS",
    summary_en:
      "XC40 battery is under the cargo floor/cover; after replacement — BMS registration. For jump-start use factory points, not random terminals.",
    body_md_en:
      "## Summary\n\nBattery access on **CMA** is non-obvious; electronics dislike sloppy jump-starts.\n\n## Procedure\n\n1. Jump points — label under the hood.\n2. Replacement — AGM/capacity per VIN.\n3. BMS registration with a scanner.\n4. Check parasitic draw after install.\n\n## Important\n\nHybrid/Recharge — separate HV rules; no work without qualification.",
  },
  "cma-xc40-atf-31492173-diy": {
    title_en: "CMA XC40 T3: partial ATF change 31492173",
    summary_en:
      "XC40 1.5 T3: drain ATF via plug/level tube, fill ~4 L OEM 31492173, level at ~50°C.",
    body_md_en:
      "## Summary\n\nDIY automatic trans fluid on **XC40 T3**.\n\n## Part numbers\n\n- ATF OEM: **31492173**\n\n## Procedure\n\nRemove air filter housing for access; after fill, warm up and check overflow.\n\n## Important\n\nDrive2 summary.",
  },
  "cma-xc40-atf-machine-flush": {
    title_en: "CMA XC40: machine ATF exchange — owner experience",
    summary_en:
      "XC40 owners debate partial vs machine ATF; logs at ~30–60k km often use dealer machine flush with Motul ATF VI.",
    body_md_en:
      "## Summary\n\nChoosing ATF service method on **XC40**.\n\n## Procedure\n\nPartial 8–12 L OEM displacement vs machine exchange; OEM fluid is costly and often counterfeited.\n\n## Important\n\nNot a Volvo interval mandate — owner log. Drive2 summary.",
  },
  "cma-xc40-main-battery-exide-ek720": {
    title_en: "CMA XC40: main battery Exide EK720",
    summary_en:
      "Petrol XC40 at ~4 years is a common time to replace the main battery; logs used Exide EK720 — size/capacity must match exactly.",
    body_md_en:
      "## Summary\n\nOn **XC40 (CMA)** the main battery is often replaced preventively at 4–5 years.\n\n## Procedure\n\nPost used **Exide EK720** from a specialist shop; load-test before buying.\n\n## Important\n\nAfter replacement on CMA/SPA a **BMS reset** is often required. Verify PN via VIN. Drive2 summary.",
  },
  "cma-xc40-service-mode-wipers": {
    title_en: "CMA XC40: wiper service mode",
    summary_en:
      "Before blade swap, raise arms via service mode in the display (not by force). Otherwise you can damage the mechanism under the cowl.",
    body_md_en:
      "## Summary\n\nOn **XC40** wipers park low; replacement needs **service position**.\n\n## Procedure\n\n1. Car menu → wipers → service position.\n2. Ignition/car — per screen instructions.\n3. Swap blade with the arm clip.\n4. Exit service mode the same way.\n\n## Important\n\nDo not lift the arm cold from park — you can break the linkage.",
  },
  "cma-xc40-vtool-pin-key": {
    title_en: "CMA XC40: VTool — key PIN and service functions",
    summary_en:
      "XC40 owners use VTool for key PIN read, service resets and calibrations (AWD/climate) when Orbit is not enough.",
    body_md_en:
      "## Summary\n\nOn **XC40**, **VTool** diagnostics: second-key PIN, adaptations, calibrations.\n\n## Procedure\n\nAuthor notes fast PIN retrieval with known CEM PIN; service mode is free.\n\n## Important\n\nNot a hacking guide — owner experience only. Drive2 summary.",
  },
  "links-obd-protocols-volvo": {
    title_en: "Links: OBD / DoIP on modern Volvo",
    summary_en:
      "SPA/CMA diagnostics is often DoIP (Ethernet), not classic CAN K-line only. A cheap ELM327 will not see much — you need a compatible interface.",
    body_md_en:
      "## Summary\n\nProtocol generations:\n\n- **P1/P2** — classic OBD/CAN; many adapters work.\n- **P3** — CAN; some functions need dealer software.\n- **SPA/CMA** — **DoIP**; a plain ELM327 is not enough for modules.\n\n## Important\n\nBefore buying a scanner, check supported platforms, not marketing “works on all Volvo”.",
  },
  "links-parts-catalogs-map": {
    title_en: "Links: where to look up Volvo part numbers",
    summary_en:
      "Short guide: EPC/dealer catalog by VIN, IPD/FCP for aftermarket, this site for P3 wiring. Do not mix PN across platforms.",
    body_md_en:
      "## Catalogs\n\n- **OEM by VIN** — dealer EPC / Volvo Parts.\n- **Aftermarket** — IPD, FCP Euro, trusted EU warehouses (verify crosses).\n- **P3 wiring** — schematic navigator on this site.\n\n## Rule\n\nThe same “XC60 filter” on P3 and SPA are **different** PN. Always platform + VIN.",
  },
  "links-vida-dice-overview": {
    title_en: "Links: VIDA / DiCE — what they are for",
    summary_en:
      "VIDA is Volvo dealer environment (diagrams, service, coding). DiCE is the interface. P3 EWD is on this site; VIDA is still needed for coding and deep info.",
    body_md_en:
      "## Summary\n\n**VIDA** + **DiCE** — factory toolchain. This site covers **P3 EWD** in the browser; module coding and full TSBs remain in VIDA/alternatives.\n\n## When to use what\n\n| Task | Where |\n|--------|-----|\n| P3 wire diagram | this site |\n| CEM/DIM coding | VIDA / compatible scanner |\n| SPA/CMA battery registration | VIDA / VTool and similar |\n\n## Important\n\nDo not confuse “flashed a module” with “opened a schematic”.",
  },
};
