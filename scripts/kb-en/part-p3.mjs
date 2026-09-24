/** @type {Record<string, { title_en: string; summary_en: string; body_md_en: string }>} */
export const partP3 = {
  "p3-accessory-belts-xc60": {
    title_en: "P3 XC60: accessory belts and tensioner — PN",
    summary_en:
      "Petrol XC60 I at service 5: outer belt 30777431, inner 31325042, tensioner 31258153, bolt 30624274. Timing belt is separate by VIN.",
    body_md_en:
      "## Summary\n\n**XC60 P3** interval service includes **accessory belts**, not the timing belt — easy to confuse.\n\n## Part numbers (log example)\n\n- Main belt (5PK): **30777431**\n- Inner belt (3PK): **31325042**\n- Tensioner: **31258153**\n- Tensioner bolt: **30624274**\n\nTiming is a separate kit (post mentions **30731727** for one car).\n\n## Important\n\nBelt routing depends on engine. **VIN only.** Drive2 summary.",
  },
  "p3-atf-seal-battery-to": {
    title_en: "P3 XC70: transaxle seal + battery at service",
    summary_en:
      "XC70 III service often combines left driveshaft trans seal and battery (Webasto kills batteries in winter).",
    body_md_en:
      "## Summary\n\nService + driveshaft seal + battery on **XC70 D5**.\n\n## Procedure\n\nAfter Webasto, weak crank — test/charge first, then replace. Left driveshaft seal is a common leak.\n\n## Important\n\nMeasure parasitic draw after modules sleep (~30–60 min).",
  },
  "p3-atf-seal-trip-note": {
    title_en: "P3 XC60: transaxle seal after ATF service",
    summary_en:
      "After ATF change, left driveshaft seal leak often appears — replace separately; trailer towing ATF temp ~90 °C.",
    body_md_en:
      "## Summary\n\nDriveshaft seal on **XC60 P3**.\n\n## Procedure\n\nDo not defer the seal when changing ATF — otherwise back on the lift.\n\n## Important\n\nATF brand comparisons in logs are subjective — not a spec test.",
  },
  "p3-battery-bms-note": {
    title_en: "P3: battery and lying BMS on the cluster",
    summary_en:
      "XC70 III with an aged battery: BMS may show low charge with a healthy battery. Replace battery; reset sometimes helps.",
    body_md_en:
      "## Summary\n\n**P3** with Webasto: battery matters in winter. Low charge message ≠ dead cell.\n\n## Procedure\n\n1. Tester reading.\n2. Replace to size/cranking spec.\n3. Reset counter via diagnostics if needed.\n\n## Important\n\nPolarity and DIN size — VIN.",
  },
  "p3-battery-cover-acom": {
    title_en: "P3 XC60: tall battery, cover and counter reset",
    summary_en:
      "Tall ~100 Ah Akom and cover; after swap teach windows and reset battery counter (low beam + fogs + hazard per log).",
    body_md_en:
      "## Summary\n\n**XC60 P3** battery without VIDA.\n\n## Procedure\n\nNegative → BMS wire → vent hose → new cover for tall case. Counter reset per log button combo.\n\n## Important\n\nRe-learn windows afterward.",
  },
  "p3-belts-dayco-service": {
    title_en: "P3 XC70: belts 31330870 / 31325042 + rollers",
    summary_en:
      "Service: fuel PU9003Z, air C35177, oil HU7198Y, alternator belt 31330870, A/C 31325042, Dayco APV2740 / OEM 31258133 rollers.",
    body_md_en:
      "## Summary\n\nBelts and filters on **XC70 III**.\n\n## PN\n\n- Alternator belt **31330870**\n- A/C belt **31325042**\n- Roller Dayco **APV2740**\n- Pulley **31258133**\n\n## Important\n\nBattery before winter — separate checklist item.",
  },
  "p3-cabin-blower-resistor": {
    title_en: "P3: heat only on max — blower resistor",
    summary_en:
      "XC60/S60 P3 blower only on max speed — almost always resistor/module under glove box or at the blower.",
    body_md_en:
      "## Summary\n\nClimate classic: **max only** → failed resistor (or electronic module).\n\n## Procedure\n\n1. Motor spins on max?\n2. Access resistor/module at blower (passenger side).\n3. Connector for melt/burn.\n4. Replace module; worn motor (high current) sometimes the cause.\n\n## Important\n\nBlower power diagram in EWD (climate / CEM).",
  },
  "p3-cabin-filter-note": {
    title_en: "P3: cabin filter under glove box",
    summary_en:
      "XC60/S60/V60 P3: filter under glove box — Torx trim, duct cover, fold element out. Airflow arrow.",
    body_md_en:
      "## Summary\n\n**P3** (incl. XC60 I) cabin filter is DIY: **under glove box**, not half the dash.\n\n## Procedure\n\n1. Lower trim (usually Torx).\n2. Open duct cover.\n3. Remove old element, folding toward passenger seat.\n4. New filter — airflow arrow.\n\n## Part numbers\n\nOEM/cross strictly by **VIN/EPC** (length varies by year). Charcoal is denser than dust-only.\n\n## Important\n\nOwner log, not HVAC wiring — diagrams in EWD navigator.",
  },
  "p3-cem-battery-faq": {
    title_en: "P3 FAQ: after battery swap CEM / keys act up",
    summary_en:
      "Typical post-battery scenario — not a wiring duplicate, but an action checklist. CEM diagrams in EWD navigator.",
    body_md_en:
      "## Not a diagram\n\nInteractive CEM EWD is on the home page. Here — **FAQ** after battery work.\n\n## Common symptoms\n\n- Clock/radio reset, low voltage messages.\n- Key not detected after full discharge.\n- Power DTCs that clear after an ignition cycle.\n\n## Checklist\n\n1. Terminals and body ground — loose negative causes CEM “ghosts”.\n2. After install let modules wake: ignition ON 1–2 min, then start.\n3. Key not authorized — diagnostics (VIDA/compatible), not random reflashing.\n4. Open CEM power diagram on site by component code when listed.\n\nWe do not copy full third-party guides — pointers and discussion links only.",
  },
  "p3-cem-wakeup-checklist": {
    title_en: "P3: CEM won't wake / no bus communication",
    summary_en:
      "No CEM comms on P3: power and ground at the module, LIN/CAN to cluster, then battery and post-replacement BMS. Do not swap CEM without diagnosis.",
    body_md_en:
      "## Summary\n\n**P3** “dead” interior often traces to **CEM**: no wake-up, no LIN to DIM, no CAN to nodes.\n\n## Checklist\n\n1. Battery ≥12.4 V resting; terminals and body ground.\n2. CEM connector power/ground (EWD on site for your config).\n3. Scanner: is CEM / DIM / others online?\n4. After battery — BMS reset or false faults persist.\n\n## Important\n\nTypical P3 failure patterns. Pin numbers in EWD navigator, not forum photos.",
  },
  "p3-coolant-hose-drain": {
    title_en: "P3 XC70: coolant hose and drain tube 31274900",
    summary_en:
      "XC70 III service: upper coolant hose and drain tube 31274900; MANN/Hengst filters, oil 0W-30 A5/B5.",
    body_md_en:
      "## Summary\n\nAir in cooling / hose leak on **P3 D5**.\n\n## PN\n\n- Drain tube **31274900**\n- Air MANN **C35177**\n- Fuel Hengst **E100KP01D182**\n\n## Important\n\nWatch engine hours in the trip computer, not only km.",
  },
  "p3-dim-pixel-fail-note": {
    title_en: "P3: DIM cluster — pixels and blank display",
    summary_en:
      "S60/V60/XC60/XC70 P3 DIM loses pixels or LIN link. Cable and power first, then board repair / replacement with coding.",
    body_md_en:
      "## Summary\n\n**DIM** on P3 ages: dark segments, blank screen, lost CAN/LIN.\n\n## Procedure\n\n1. Connector behind cluster and harness integrity.\n2. DIM power/grounds per diagram.\n3. Board repair (common kits) vs new/used — used needs pairing.\n\n## Important\n\nNot CEM failure if other modules are alive and only the cluster is dark.",
  },
  "p3-filters-fuel-air-cabin-pn": {
    title_en: "P3 D5: fuel / air / cabin filter PN table",
    summary_en:
      "XC70 III log reference: fuel 32242188 (MANN PU9003Z), air 31370161 (C35177), charcoal cabin 31390880 (CUK2733). Verify VIN.",
    body_md_en:
      "## Summary\n\n**P3 D5** filter set owners keep in one list.\n\n## Part numbers\n\n- Fuel OEM **32242188** · cross **MANN PU9003Z**\n- Air OEM **31370161** · **MANN C35177**\n- Charcoal cabin OEM **31390880** · **MANN CUK2733**\n- Oil (reminder): **30788490** / HU719/8Y — see other note\n\n## Important\n\nCrosses vary by engine/market. **VIN/EPC.** Summary, not full catalog.",
  },
  "p3-glow-plugs-bosch-008": {
    title_en: "P3 D5: glow plugs Bosch 0 250 603 008",
    summary_en:
      "XC60/XC70 D5 glow fault — replace full set. Common OEM cross 30777311 — Bosch 0250603008.",
    body_md_en:
      "## Summary\n\n**P3 D5** diesel: cold shake / glow code. Replace **all** plugs as a set.\n\n## Part numbers\n\n- OEM ref **30777311**\n- Bosch **0 250 603 008**\n\n## Important\n\nVerify VIN. Drive2 summary.",
  },
  "p3-glow-plugs-bosch-403": {
    title_en: "P3: quick glow plug swap Bosch 0 250 403 001",
    summary_en:
      "Short note: XC70 D5 full set Bosch 0250403001 (~30 min).",
    body_md_en:
      "## Summary\n\nFull set Bosch **0 250 403 001** on **XC70 D5**.\n\n## Important\n\nReplace all at once. VIN!",
  },
  "p3-glow-plugs-dg620": {
    title_en: "P3 XC70: glow plugs DG620 / Bosch 0250403001",
    summary_en:
      "XC70 III alternatives: DG620 and Bosch 0 250 403 001. Rough cold start is the usual trigger.",
    body_md_en:
      "## Summary\n\n**XC70 III D5** glow plugs — winter consumable.\n\n## Part numbers\n\n- **DG620**\n- Bosch **0 250 403 001**\n\n## Important\n\nNot petrol spark plugs.",
  },
  "p3-glow-plugs-xc60-bosch": {
    title_en: "P3 XC60: glow plug set Bosch before winter",
    summary_en:
      "XC60 I D5 ~170k km: replace full Bosch set (same as OEM) even if resistance “looks OK”.",
    body_md_en:
      "## Summary\n\nCold-start prevention on **XC60 D5**: Bosch glow plug set.\n\n## Procedure\n\nReplace all. Old plugs may “beep” on a meter but fail under load.\n\n## Important\n\nVIN required.",
  },
  "p3-haldex-pump-filter-note": {
    title_en: "P3 AWD: Haldex pump and strainer — when it whines",
    summary_en:
      "XC60/XC70 P3 AWD rear noise and coupling fault often dirty Haldex Gen 4/5 pump strainer. Fluid + clean/replace pump per VIN.",
    body_md_en:
      "## Summary\n\n**Haldex** on P3 AWD is sensitive to fluid and pump strainer.\n\n## Procedure\n\n1. Read codes (DEM / AWD).\n2. Drain — black/metal → teardown.\n3. Strainer: clean or new pump assembly.\n4. Spec Haldex fluid, not generic ATF.\n\n## Important\n\nInterval and fluid PN — EPC/VIN. Not angle gear service.",
  },
  "p3-keyless-antenna-checklist": {
    title_en: "P3 Keyless: key not detected in cabin",
    summary_en:
      "P3 keyless: key battery, cabin/bumper antennas, KVM module. “Only at the door” often cabin antenna, not the key.",
    body_md_en:
      "## Summary\n\n**Keyless** uses several antennas. One dead antenna gives odd zones.\n\n## Checklist\n\n1. Key battery and spare key.\n2. KVM / CEM codes.\n3. Cabin (floor/console) and exterior antennas.\n4. After body repair — bumper connectors.\n\n## Important\n\nDo not program a new key until antennas are ruled out.",
  },
  "p3-oil-filter-d5": {
    title_en: "P3 D5: oil filter 30788490 and housing cap",
    summary_en:
      "XC70 III D5 often uses OEM 30788490 (MANN HU 719/8). If it leaks — housing cap 30788489.",
    body_md_en:
      "## Summary\n\nPlanned **P3 D5** service: filter element and cap if leaking.\n\n## Part numbers\n\n- Filter OEM **30788490**\n- Cross **MANN HU 719/8** (HU7198Y)\n- Cap if leaking **30788489**\n\n## Important\n\nVerify VIN. Cap torque per manual — no overtight. Drive2 summary.",
  },
  "p3-oil-filters-diy": {
    title_en: "P3 XC70: oil and all filters DIY",
    summary_en:
      "XC70 III DIY: Castrol 0W-30, MANN HU7198X, air 31370161, fuel PU9003Z; service reset via VIDA/DIM.",
    body_md_en:
      "## Summary\n\nFull oil and filters on **XC70 D5**.\n\n## PN\n\n- Oil **MANN HU7198X**\n- Air Volvo **31370161**\n- Fuel **MANN PU9003Z**\n\n## Procedure\n\nAfter fuel filter — 3–4 key cycles before start. Service indicator reset via diagnostics.",
  },
  "p3-radiator-ac-pack": {
    title_en: "P3: engine + A/C radiator bundle",
    summary_en:
      "XC70 III: compressor noise/damaged fins — replace engine radiator, condenser and seals (example 988847).",
    body_md_en:
      "## Summary\n\n**P3** radiator jobs often pair engine + A/C units.\n\n## Typical parts\n\n- Radiators — VIN\n- Seals (example **988847**)\n- Coolant Volvo (**31439721** / crosses)\n\n## Important\n\nVacuum/recharge A/C after work.",
  },
  "p3-s60-p2-timing-thermostat-gates": {
    title_en: "P2 S60: timing belt + Gates TH35991 thermostat",
    summary_en:
      "S60 I timing job often exposes leaks: cam seal and thermostat; log used Gates TH35991.",
    body_md_en:
      "## Summary\n\n**S60 I** bundle: timing/pump + leak fixes.\n\n## Part numbers\n\n- Thermostat Gates **TH35991** (log example)\n\n## Important\n\nPlatform P2 (not S60 II / P3). VIN. Drive2 summary.",
  },
  "p3-s60ii-consumables-sheet": {
    title_en: "P3 S60 II: service consumables cheat sheet",
    summary_en:
      "Oil 31330050 / Mann W7015, air 31370161 / C35177, cabin 31390880 / CUK2733; pads by 16″/16.5″ disc.",
    body_md_en:
      "## Summary\n\nService cheat sheet **S60 II** (P3 generation).\n\n## PN\n\n- Oil **31330050** / Mann **W7015**\n- Air **31370161** / **C35177**\n- Cabin **31390880** / **CUK2733**\n- Pads: TRW **GDB1683/1684**, rear **GDB1685**\n\n## Important\n\nAlways VIN.",
  },
  "p3-s60ii-thermostat-heater-circuit": {
    title_en: "P3 S60 II: thermostat heater fault ECM-P0597",
    summary_en:
      "S60 II petrol: open circuit on electronic thermostat heater; OEM 31686560 or used 31474989 + adaptation.",
    body_md_en:
      "## Summary\n\n**ECM-P059700** — thermostat heater control circuit open on **S60 II**.\n\n## Part numbers\n\n- New OEM ref **31686560** (costly)\n- Log used **31474989**\n- Gasket **31368063**\n\n## Important\n\nSoftware adaptation often required. VIN mandatory. Drive2 summary.",
  },
  "p3-s80-battery-topla-bms": {
    title_en: "P3 S80 II: Topla 100 Ah battery and BMS reset",
    summary_en:
      "S80 II after new battery (e.g. Topla 100 Ah): clear faults, reset BMS counter, let the car rest.",
    body_md_en:
      "## Summary\n\nMain battery on **S80 II** + mandatory **BMS reset**.\n\n## Procedure\n\nAuthor used Topla Energy ~100 Ah / 800 A; after install — fault clear and BMS reset.\n\n## Important\n\nBattery parameters must match CEM profile. Drive2 summary.",
  },
  "p3-service-log-xc60": {
    title_en: "P3 XC60: service log — fuel filter and radiators",
    summary_en:
      "Typical XC60 I D5 log: fuel filter, radiator wash/replace, axle oils — interval checklist.",
    body_md_en:
      "## Summary\n\nChecklist from **XC60 P3** log: fuel filter, radiators, axle/Haldex oils.\n\n## Important\n\nIntervals are hints. VIN beats someone else's log.",
  },
  "p3-tf80-atf-drain-fill": {
    title_en: "P3: TF-80 automatic — partial ATF change",
    summary_en:
      "Many P3 use Aisin TF-80SC. Partial drain/fill is safer than full exchange without a machine; level at operating temperature per procedure.",
    body_md_en:
      "## Summary\n\n“Lifetime” ATF still ages. **TF-80** often gets drain & fill.\n\n## Procedure\n\n1. Fluid only with Aisin/Volvo approval for your box.\n2. Pan drain, filter as needed.\n3. Level — hot procedure, not cold dipstick (may have no stick).\n4. Repeat at 1–2k km if fluid was dirty.\n\n## Important\n\nOverfill hurts like underfill. Do not trust random internet volumes without the procedure.",
  },
  "p3-thermostat-d5-pn": {
    title_en: "P3 D5: thermostat 31368373 and hose rings",
    summary_en:
      "XC70/XC60/S80 P3 D5: weak heat on highway often thermostat OEM 31368373; replace hose O-rings too.",
    body_md_en:
      "## Summary\n\n**P3 D5** (XC70 III etc.): heat weak at speed, Webasto only helps parked — often **thermostat** (rubber insert in housing).\n\n## Part numbers\n\n- Thermostat OEM **31368373**\n- Hose seals (log examples) **30622784**, **31109235**\n- Sometimes throttle gasket **30757766** if EGR/throttle removed\n\nSome engines need EGR access — not a five-minute job.\n\n## Important\n\n**Not an EWD diagram** — parts context only. VIN/EPC. Drive2 summary.",
  },
  "p3-thermostat-gasket-gates": {
    title_en: "P3 D5: housing gasket + Gates thermostat",
    summary_en:
      "Leak at thermostat housing joint: gasket (e.g. GParts VO31293699GA) and Gates TH35991 element — match to your housing.",
    body_md_en:
      "## Summary\n\n**P3 D5** wet joint between thermostat housing halves — replace **gasket** and **thermostat element** (not always full OEM unit).\n\n## Part numbers (author post)\n\n- Gasket **GParts VO31293699GA** (cross 31293699 / 31293700 line)\n- Thermostat **Gates TH35991**\n\nLater housings may differ on check-valve in the plate — blind cross is risky.\n\n## Important\n\nVerify VIN. Check coolant level and air after. Summary, not full compatibility table.",
  },
  "p3-timing-belt-interval-d5": {
    title_en: "P3 D5: timing belt interval and water pump",
    summary_en:
      "P3 D5: replace belt and pump as a kit on interval/mileage. Do not delay — snap = valves. Check interval for market and year.",
    body_md_en:
      "## Summary\n\n**D5** on P3 is timing belt driven. Failure is catastrophic.\n\n## Procedure\n\n- **Belt + rollers + pump** one kit.\n- Mileage/years per your market book (often ~120–180k km / 8–10 years).\n- After — tension and pump leak check.\n\n## Important\n\nExact interval and PN — VIDA/EPC by VIN.",
  },
  "p3-timing-pump-diy-xc60": {
    title_en: "P3 XC60: timing + AISIN pump DIY",
    summary_en:
      "DIY: AISIN WV-009 pump + bolts 985151, crank seal 31293007, coolant 31439724, pulley 31258133, Dayco belts.",
    body_md_en:
      "## Summary\n\nDIY timing/pump on **XC60 D5**.\n\n## PN\n\n- Pump **AISIN WV-009**\n- Bolts **985151**\n- Crank seal **31293007**\n- Coolant **31439724**\n\n## Important\n\nINA roller life in logs is a hint, not a warranty.",
  },
  "p3-timing-xc60-big": {
    title_en: "P3 XC60: timing 31359568 + covers + fluids",
    summary_en:
      "~190k km XC60 I D5: timing 31359568, A/C belt 31325042, covers 30757900/30757901, engine/trans/axle/Haldex fluids.",
    body_md_en:
      "## Summary\n\nMajor timing service **XC60 P3 D5**.\n\n## PN\n\n- Timing **31359568**\n- Covers **30757900** / **30757901**\n- A/C belt **31325042**\n\n## Important\n\nCover rubber hardens and can get under the belt — replace preventively.",
  },
  "p3-to-webasto-pump": {
    title_en: "P3 XC70: service + Webasto Pierburg pump",
    summary_en:
      "XC70 III D5 service: 5W-30, filter 30788490, air 31370161, brake fluid + Webasto pump 702671500 Pierburg when motor whines.",
    body_md_en:
      "## Summary\n\nPlanned **XC70 D5** + auxiliary heater pump.\n\n## PN\n\n- Oil filter **30788490**\n- Air **31370161**\n- Webasto pump **702671500** (Pierburg)\n\n## Important\n\nWhine with climate off — check auxiliary heater pump.",
  },
  "p3-to130-mann-set": {
    title_en: "P3 XC70: 130k service — MANN set + Castrol C3",
    summary_en:
      "Classic set: C35177, PU9003Z, HU7198Y, CUK2733 and Castrol 0W-30 C3. Often with EGR cleaning.",
    body_md_en:
      "## Summary\n\nTypical filter bundle **XC70 D5** mid service.\n\n## PN\n\n- Air **MANN C35177**\n- Fuel **PU9003Z**\n- Oil **HU7198Y**\n- Cabin **CUK2733**\n\n## Important\n\nVerify OEM crosses via VIN.",
  },
  "p3-to150-belt-brakes": {
    title_en: "P3 XC70: 150k service — belts and rear brakes",
    summary_en:
      "150k: C3 5W-30, HU719/8Y, C35177, accessory kit 31401425, A/C belt 31325042, rear Brembo 09.9587.11 / P86021.",
    body_md_en:
      "## Summary\n\nLarge **XC70 III** service with belts and rear brakes.\n\n## PN\n\n- Accessory kit **31401425**\n- A/C belt **31325042**\n- Rear disc Brembo **09.9587.11**, pads **P86021**\n- Brake fluid Volvo **32214958**\n\n## Important\n\nDisc size — VIN.",
  },
  "p3-transfer-case-seals": {
    title_en: "P3 XC70: angle gear seals + turbo hoses",
    summary_en:
      "Angle gear service: Corteco seals, breather 30681138, sleeve LR002746, crank seal 31293007; often with silicone intercooler hoses.",
    body_md_en:
      "## Summary\n\nAngle gear and boost hose leaks on **XC70 III**.\n\n## PN\n\n- Crank seal **31293007**\n- Angle breather **30681138**\n- Corteco seals **19035438B** / **49357901**\n\n## Important\n\nAfter teardown — trans level and wash oil off units.",
  },
  "p3-washer-pump-dual-tank": {
    title_en: "P3: headlamp/windshield washer — two pumps",
    summary_en:
      "XC60/XC70 P3 often has two pumps (glass / headlamps). One circuit dead — check that pump, relay and jets, not the whole reservoir.",
    body_md_en:
      "## Summary\n\nTwo outlets = two pumps or valving.\n\n## Checklist\n\n1. Which circuit failed: windshield or headlamps.\n2. Pump power on stalk command.\n3. Clogged jets / check valve.\n4. Level and wrong summer fluid in winter.\n\n## Important\n\nWasher diagram in EWD (washer / CEM).",
  },
  "p3-water-pump-aisin": {
    title_en: "P3 D5: AISIN WV-009 pump and timing kit",
    summary_en:
      "D5 timing job often uses AISIN WV-009 (30751022) + kit 31359568. Check bolt kit contents.",
    body_md_en:
      "## Summary\n\nCoolant pump on **P3 D5** ships with **timing** kit.\n\n## Part numbers\n\n- Pump **AISIN WV-009** / **30751022**\n- Timing **31359568**\n- Accessory **31401425**\n\n## Important\n\nVerify bolts in the box.",
  },
  "p3-wipers-bundle": {
    title_en: "P3: wiper blades — service position and PN",
    summary_en:
      "Front blades: service position after ignition off. Example kit VO31333385 / Valeo 574377 — check lengths.",
    body_md_en:
      "## Summary\n\n**P3** blade swap needs **service position** or you risk the linkage.\n\n## Procedure\n\nAfter ignition off, pull stalk once up — arms park in service.\n\n## Part numbers (log)\n\n- Kit **VO31333385**\n- Cross **Valeo 574377**\n\n## Important\n\nL/R lengths differ. VIN. Drive2.",
  },
  "p3-xc60-brakes-ate-trw": {
    title_en: "P3 XC60: ATE front / TRW rear pads",
    summary_en:
      "180k service: HU7198Y, C35177, PU9003Z, CUK2733; front ATE 13.0460-7272.2, rear TRW GDB1685, DOT4 ESP fluid.",
    body_md_en:
      "## Summary\n\nBrakes + filters **XC60 I D5**.\n\n## PN\n\n- Front ATE **13.0460-7272.2**\n- Rear TRW **GDB1685**\n- MANN filters as above\n\n## Important\n\nLubricate caliper slides on pad service.",
  },
  "p3-xc60-brakes-battery-cover": {
    title_en: "P3 XC60: brakes all around + battery cover",
    summary_en:
      "XC60 I: timing 31359568, full brakes, fluid; tall battery cover 31335286 if stock cover broken.",
    body_md_en:
      "## Summary\n\nBrakes + timing + battery bits **XC60 P3**.\n\n## PN\n\n- Timing **31359568**\n- Battery cover **31335286**\n\n## Important\n\nDisc thickness — VIDA/manual.",
  },
  "p3-xc60-brakes-to150-disks": {
    title_en: "P3 XC60 I: 150k service and brake discs",
    summary_en:
      "XC60 I at 150k: filters, PU9003Z, disc/pad replacement; new pads with new discs (OEM India in post).",
    body_md_en:
      "## Summary\n\nService + brakes **XC60 I**.\n\n## Procedure\n\nFuel Mann **PU9003Z**; with new discs always new pads (front/rear PN in post).\n\n## Important\n\nDrive2 summary.",
  },
  "p3-xc60-turbo-hoses-radiator": {
    title_en: "P3 XC60 I: turbo hoses and engine radiator",
    summary_en:
      "XC60 D5 coolant/oil leaks: turbo/intercooler hose set and radiator replacement with front end off.",
    body_md_en:
      "## Summary\n\nWeak spot **XC60 I D5** — boost hoses and engine radiator.\n\n## Procedure\n\nRadiator out with front panel; clean condenser/intercooler, refill coolant.\n\n## Important\n\nDrive2 summary.",
  },
  "p3-xc60-turbo-rebuild-big-to": {
    title_en: "P3 XC60 D5: turbo rebuild + flush and service",
    summary_en:
      "After turbo rebuild on XC60 D5: radiator/EGR/hose flush, turbo seals and routine service items.",
    body_md_en:
      "## Summary\n\nTurbo rebuild + related service **XC60 I D5**.\n\n## Procedure\n\nCartridges HD/LP, turbo seal kit, EGR/throttle clean, DPF regen if needed.\n\n## Important\n\nDrive2 summary.",
  },
  "p3-xc70-battery-bms-reset-vida": {
    title_en: "P3 XC70 III: battery replacement and BMS reset in CEM",
    summary_en:
      "After XC70 III battery swap, reset BMS in VIDA (CEM → Advanced); leave car locked 5–6 hours without starting.",
    body_md_en:
      "## Summary\n\n**P3** BMS learns the installed battery. No reset — undercharge/faults.\n\n## Procedure\n\n- Charger negative on **chassis**, not battery post\n- VIDA: **CEM → Advanced → Battery Monitoring Sensor → reset**\n- No start ~5–6 h after reset\n\n## Important\n\nDrive2 summary, not dealer procedure replacement.",
  },
  "p3-xc70-egr-full-replace": {
    title_en: "P3 XC70 III: full EGR assembly replacement",
    summary_en:
      "XC70 III D5 EGR faults: replace valve, cooler and flow housing; seal ring 30670569 is critical.",
    body_md_en:
      "## Summary\n\nFull **EGR** repair on P3 D5 vs “clean and reassemble”.\n\n## Part numbers\n\n- Flow housing/valve ref **31219277**\n- Seal ring **30670569**\n\n## Important\n\nLabor heavy; wrong diagnosis is expensive. Drive2 summary.",
  },
};
