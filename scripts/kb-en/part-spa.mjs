/** @type {Record<string, { title_en: string; summary_en: string; body_md_en: string }>} */
export const partSpa = {
  "spa-air-suspension-leak-check": {
    title_en: "SPA: air suspension — sinks overnight",
    summary_en:
      "XC90/V90 air ride: morning on a bag — find bag/line leaks and compressor duty before replacing the compressor.",
    body_md_en:
      "## Summary\n\nCompressor is often secondary; **leak** is primary.\n\n## Checklist\n\n1. Air suspension codes.\n2. Soapy water / listen at bags and fittings.\n3. Fill time and compressor overheat.\n4. Valve block (distribution unit).\n\n## Important\n\nDriving with compressor always on kills it in weeks.",
  },
  "spa-aux-battery-error-order": {
    title_en: "SPA: 12V charging fault — AUX and main battery order",
    summary_en:
      "DTC B10A613 / “12V battery critical”: auxiliary battery dead. After replacement: disconnect AUX, then main in trunk; reconnect AUX → main.",
    body_md_en:
      "## Summary\n\nBattery connection order on **SPA** after AUX replacement.\n\n## Procedure\n\nPlugging in a new AUX alone often leaves the cluster message. You need a cycle with the main battery.\n\n## Important\n\nTest auxiliary voltage — “equipment won't power” = full failure.",
  },
  "spa-battery-main-xc90": {
    title_en: "SPA XC90: main battery — OEM 31652065",
    summary_en:
      "XC90 II main battery is often OEM 31652065 (~80 Ah AGM). After swap owners discuss registration/BMS — not “just terminals”.",
    body_md_en:
      "## Summary\n\n**SPA XC90** main battery in engine bay; auxiliary may be separate. Typical OEM main: **31652065**.\n\n## Procedure\n\n1. Ignition OFF, negative first, then positive.\n2. Match capacity/type (AGM).\n3. Check Webasto/start-stop; BMS procedure via scanner if needed.\n\n## Important\n\nSPA shelf is partial. Verify PN via VIN. Drive2 summary.",
  },
  "spa-bms-12v-aux-reset": {
    title_en: "SPA: BMS reset after 12V / AUX replacement",
    summary_en:
      "XC90/XC60 II / S90 after main or auxiliary battery: register in BMS or get charging faults and “battery fail”. VIDA/VTool/compatible scanner.",
    body_md_en:
      "## Summary\n\n**SPA** tracks battery history. New battery without registration = false faults.\n\n## Procedure\n\n1. Correct AGM/EFB and capacity.\n2. Register replacement in CEM/BMS.\n3. AUX (trunk) — separate procedure on many cars.\n4. Verify alternator charging after.\n\n## Important\n\nLong disconnect without support power risks module sync issues.",
  },
  "spa-cabin-filter-test-note": {
    title_en: "SPA: charcoal cabin filter — OEM 31407748 and fakes",
    summary_en:
      "SPA often uses OEM 31407748. Counterfeits without Netbox packing — check box and filter tabs, not price alone.",
    body_md_en:
      "## Summary\n\n**SPA** charcoal cabin is often **31407748**. Cross **MANN CUK34003**. Fakes on secondary market.\n\n## Procedure\n\nCheck packaging (Netbox on OEM supply), tab markings, pack density. Outdoor odors after install are a quick test.\n\n## Important\n\nSPA shelf partial. Drive2 discussions — verify VIN.",
  },
  "spa-cabin-filter-xc60ii": {
    title_en: "SPA: XC60 II cabin filter — OEM and crosses",
    summary_en:
      "SPA XC60 II: filter under glove box without removing the box — Torx T20, latch cover. OEM 31407748 / 31404469, MANN CUK34003.",
    body_md_en:
      "## Summary\n\n**SPA** (XC60 II family) cabin filter: panel under glove box, duct cover, element.\n\n## Part numbers\n\n- Charcoal OEM **31407748**\n- Dust/related OEM **31404469**\n- Cross **MANN CUK34003** (Nordfil CN1141K etc. — verify size)\n\n## Procedure\n\nTorx **T20** lower panel → twist cover latches → side clips. Sometimes detach the “snout” duct.\n\n## Important\n\nSPA shelf on site is **partial** (no full EWD). Verify PN via VIN. Drive2 summary.",
  },
  "spa-ewd-status": {
    title_en: "SPA: what wiring diagrams exist publicly",
    summary_en:
      "No full public SPA EWD. VIDA by subscription and some public PDFs (NHTSA). This site has no SPA schematics.",
    body_md_en:
      "## SPA shelf status\n\n**ewd-volvo.ru** interactive diagrams are **P3 only**. Full SPA catalog (XC90 II, XC60 II, S90/V90…) was not published openly.\n\n## What people use\n\n- **VIDA** — official dealer tool (subscription).\n- Public PDFs for specific MY (regulators / NHTSA) — excerpts, not full EWD.\n\nShelf marked **partial**: curated notes and links only, not a wiring catalog.",
  },
  "spa-filters-xc90ii": {
    title_en: "SPA XC90 II: cabin and engine air filters",
    summary_en:
      "XC90 II cabin under glove box (~15 min); charcoal OEM 31407748, engine air 31370089. Climate flow often improves after.",
    body_md_en:
      "## Summary\n\n**XC90 II (SPA)** easy consumables: **cabin** (under glove box) and **engine air** (under hood).\n\n## Part numbers (log)\n\n- Charcoal cabin OEM **31407748**\n- Engine air OEM **31370089**\n\nFactory boxes may show Mahle/Mann — trust the number on the label.\n\n## Procedure\n\nCabin: remove cover under glove box, install to flow mark. Air: unclip housing.\n\n## Important\n\nVerify VIN. No full SPA EWD here — notes only. Drive2.",
  },
  "spa-fluids-xc60ii-full": {
    title_en: "SPA XC60 II: fluids and filters at 120k km",
    summary_en:
      "Liqui Moly 0W-20, HU8014Z, C29021, CUK34003, fuel 32312226, ATF 31492173, Haldex 32240904, axle 32240903.",
    body_md_en:
      "## Summary\n\nFull fluid service **XC60 II**.\n\n## PN\n\n- Oil filter **HU8014Z**\n- Air **C29021**\n- Cabin **CUK34003**\n- Fuel **32312226**\n- Haldex **32240904**\n\n## Important\n\nVolumes per drain/fill procedure.",
  },
  "spa-fuel-filter-s90-kl1055": {
    title_en: "SPA S90 T5: fuel filter Mahle KL1055",
    summary_en:
      "Underbody fuel filter: Mahle KL1055; nearby Filtron AP180/4 and K1384A. Lines are pressurized.",
    body_md_en:
      "## Summary\n\nFuel filter on **S90**.\n\n## PN\n\n- **Mahle KL1055**\n- Air Filtron **AP180/4**\n- Cabin **K1384A**\n\n## Important\n\nDepressurize / catch fuel.",
  },
  "spa-haldex-angle-brake-fluid": {
    title_en: "SPA: Haldex 31367940 + angle/rear fluids + brake fluid",
    summary_en:
      "AWD maintenance: angle and rear axle oil, Haldex 31367940 with strainer clean and Launch bleed; pan plug 31325479; pump kit 31325413.",
    body_md_en:
      "## Summary\n\nSPA AWD: Haldex + axles + brake fluid.\n\n## PN\n\n- Haldex **31367940**\n- Pan plug **31325479**\n- Pump rebuild **31325413** (VAG cross sought as cheap alt — at your risk)\n\n## Procedure\n\nStrainer, ~0.5 L + top-up after bleed. Angle plug O-ring as needed.\n\n## Important\n\nNo ATF/75W-90 in Haldex.",
  },
  "spa-oil-spec-0w20-note": {
    title_en: "SPA: 0W-20 oil — spec and interval",
    summary_en:
      "SPA petrol/mild hybrid engines usually need Volvo-approved 0W-20. Do not use “generic 5W-30”. Interval per campaigns and market.",
    body_md_en:
      "## Summary\n\nWrong viscosity on SPA hits oil pump and VVT.\n\n## Procedure\n\n- Oil with **Volvo** approval (often VCC RBS0-2AE / OEM lists).\n- Filter only from EPC for your engine.\n- Oil consumption within spec on new engines is normal — not instant “rings”.\n\n## Important\n\nT8/T6 hybrids — same 12V rules plus separate inverter cooling.",
  },
  "spa-polestar-brake-pads-note": {
    title_en: "SPA: pads/discs — standard vs Performance",
    summary_en:
      "XC60/XC90 II brake sizes vary by trim (standard / R-Design / Polestar). Measure disc and carrier by VIN, not photos.",
    body_md_en:
      "## Summary\n\nOne SPA body ≠ one brake size.\n\n## Procedure\n\n1. Measure disc or use EPC.\n2. Pads and wear sensors per axle.\n3. Rear EPB adaptation after (scanner procedure).\n\n## Important\n\nDo not wind EPB without service mode.",
  },
  "spa-s60iii-brakes-brembo": {
    title_en: "SPA S60 III: 345/320 Brembo brakes + service",
    summary_en:
      "Discs Brembo 09C93611 / 09C93811, pads P86029 / P86027; Wolf 0W-20, Filtron OE6624, TRW PFB401SE brake fluid.",
    body_md_en:
      "## Summary\n\nService + brakes **S60 III** (SPA).\n\n## PN\n\n- Front disc **09C93611**, pads **P86029**\n- Rear **09C93811** / **P86027**\n- Oil filter Filtron **OE6624**\n\n## Important\n\n345/320 mm is not the only S60 III size.",
  },
  "spa-s90-aux-battery-haldex-wipers": {
    title_en: "SPA S90: aux battery 32238082 + Haldex + wipers",
    summary_en:
      "S90 II dealer list: start/stop aux 32238082, Haldex fluid 31367940, wipers 32282838.",
    body_md_en:
      "## Summary\n\nService bundle **S90 II**: aux battery + Haldex + wipers.\n\n## Part numbers\n\n- Aux **32238082**\n- Haldex **31367940**\n- Wipers **32282838**\n\n## Important\n\nDrive2 summary.",
  },
  "spa-s90-aux-battery-ytx12": {
    title_en: "SPA S90: auxiliary Start/Stop battery YTX12-BS",
    summary_en:
      "Small battery at strut tower: YTX12-BS (152×88×131). Crosses Bosch M6 014, Varta 510012009, Yuasa YTX12-BS. Start/Stop fault often dead “moto” battery.",
    body_md_en:
      "## Summary\n\nAuxiliary Start/Stop battery on **S90**.\n\n## PN / size\n\n- **YTX12-BS** form factor\n- Bosch **M6 014**, Varta **510012009**, Yuasa **YTX12-BS**\n\n## Important\n\nCluster message may linger — see power-down procedure.",
  },
  "spa-s90-brakes-plugs": {
    title_en: "SPA S90: ATE pads and plugs 32290011",
    summary_en:
      "Front/rear ATE 13.0460-7377.2 / 7326.2, plugs Volvo 32290011, fluid 32214958.",
    body_md_en:
      "## Summary\n\nBrakes + plugs on **S90**.\n\n## PN\n\n- Plugs **32290011**\n- ATE front **13.0460-7377.2**, rear **13.0460-7326.2**\n- Fluid **32214958**\n\n## Important\n\nPad hardware varies by trim.",
  },
  "spa-s90-to-oem-filters": {
    title_en: "SPA S90: service — OEM 32140029 / 31370089 / 31673604",
    summary_en:
      "~110k km: oil 32140029, fuel 32242191, cabin 31407748, air 31370089, plugs 31673604.",
    body_md_en:
      "## Summary\n\nOEM service bundle **S90 II**.\n\n## PN\n\n- **32140029** / **32242191** / **31407748** / **31370089**\n- Plugs **31673604**\n\n## Procedure\n\nAngled plugs — thin 14 mm socket, clean wells.",
  },
  "spa-s90-wipers-oem-32341610": {
    title_en: "SPA S90: wipers OEM 32341610 (ex 32282838)",
    summary_en:
      "S90 OEM 32341610 (old 32282838). Same blades on V90 from 2016 and XC90 from 2015. Service mode in SPA menu.",
    body_md_en:
      "## Summary\n\n**S90 II** wiper swap — service mode in menu.\n\n## PN\n\n- Current **32341610**\n- Old **32282838**\n\n## Important\n\nXC90/V90 crosses — verify length and mount.",
  },
  "spa-software-update-note": {
    title_en: "SPA: software updates and Sensus/Google",
    summary_en:
      "SPA updates via OTA or dealer. Save profiles and check VIN campaigns before visit. Not a substitute for hardware diagnosis.",
    body_md_en:
      "## Summary\n\nInfotainment and module software varies by year (Sensus vs Android Automotive).\n\n## Procedure\n\n- Open campaigns by VIN at dealer.\n- After update — cameras/parking/phone.\n- Post-OTA module faults sometimes need reflash — rule out 12V first.\n\n## Important\n\nLow 12V during update risks bricked head unit.",
  },
  "spa-spark-plugs-air-filter": {
    title_en: "SPA XC90: plugs and air filter — PN",
    summary_en:
      "~60k km petrol SPA: plugs (OEM 32290011 or kit 31673604) and air MANN C29021 / C29021M. Needs 14 mm socket.",
    body_md_en:
      "## Summary\n\nEasy part of major service **XC90 II**: **plugs** + **engine air filter**.\n\n## Part numbers\n\n- Plugs: kit **31673604** or **32290011** — confirm VIN/engine\n- Air **MANN C29021** / **C29021M**\n\n## Procedure\n\nAir box Torx T25. Plugs — coils + **14 mm** socket (ceramic damage risk).\n\n## Important\n\nNot the cabin filter (separate note). Verify VIN.",
  },
  "spa-v90-bms-reset-vtool": {
    title_en: "SPA V90: BMS reset after main battery",
    summary_en:
      "V90/CC after new main battery: reset BMS (VTool / Launch); battery parameters must match CEM profile.",
    body_md_en:
      "## Summary\n\nMain battery on **SPA** without BMS reset skews charging.\n\n## Procedure\n\n- VTool: Service → Misc → **Reset BMS**\n- Replacement V/A/Ah = original\n\n## Important\n\nDrive2 summary.",
  },
  "spa-v90-first-to-hengst": {
    title_en: "SPA V90 CC: first service — Hengst + 0W-20",
    summary_en:
      "After buying V90 CC: Hengst filters, Mann cabin, Liqui Moly Special Tec V 0W-20; rear brakes wear faster with EPB.",
    body_md_en:
      "## Summary\n\nFirst service after buying **V90 Cross Country**.\n\n## Procedure\n\nOil more often than filters; rear discs need attention with electronic parking brake.\n\n## Important\n\nVIN beats seller's story.",
  },
  "spa-v90-main-battery-delta": {
    title_en: "SPA V90 CC: main battery and Webasto refusal",
    summary_en:
      "Engine cranks, Webasto at −4 °C reports low charge. Replace main battery (OEM ref 31419211 / same form factor); don't forget vent plug.",
    body_md_en:
      "## Summary\n\nWebasto quits while start still works — typical main battery signal on **V90 CC**.\n\n## PN\n\n- OEM ref **31419211**\n- Same case/polarity as original\n\n## Important\n\nInstall vent plug/hose.",
  },
  "spa-wipers-xc90-df076": {
    title_en: "SPA XC90: wipers DENSO DF-076",
    summary_en:
      "Service mode from screen, front DENSO DF-076, rear OEM 31349857.",
    body_md_en:
      "## Summary\n\nWiper swap **XC90 II**.\n\n## PN\n\n- Front **DENSO DF-076**\n- Rear **31349857**\n\n## Procedure\n\nService mode → latch button.",
  },
  "spa-xc60-angle-gear-oil": {
    title_en: "SPA XC60 II: angle and rear axle oil 31259380",
    summary_en:
      "Service 7 with engine oil: angle and rear axle — OEM 31259380. One liter often short (~100 ml) with deep air extraction; remove hose for access.",
    body_md_en:
      "## Summary\n\nAWD axle oils **XC60 II**.\n\n## PN\n\n- Volvo **31259380** (buy >1 L)\n- Engine oil filter nearby **32140029** + **977751**\n\n## Procedure\n\nRemove air hose for angle fill; rusty clamp — replace.\n\n## Important\n\nVolume depends on extraction method (air vs syringe).",
  },
  "spa-xc60-aux-battery-reset": {
    title_en: "SPA XC60: clear fault after AUX battery swap",
    summary_en:
      "CEM-B10A613 / “Start/Stop service required”: replacing the battery is not enough. AUX off → main negative → BCSM plug S → wait ≥15 min → reverse → clear CEM DTCs.",
    body_md_en:
      "## Summary\n\nProcedure after auxiliary battery on **XC60 II**.\n\n## Checklist\n\n1. Remove AUX (cover, terminals).\n2. Main battery negative.\n3. Plug **S** on **BCSM**.\n4. Wait **≥15 minutes** (new AUX installed, terminals still off).\n5. Plug S → AUX terminals → main negative.\n6. Active mode → clear CEM faults with scanner.\n\n## Important\n\nWithout pause and plug S the message often remains.",
  },
  "spa-xc60-brake-fluid-interval": {
    title_en: "SPA XC60 II: brake fluid 32214958 on schedule",
    summary_en:
      "Volvo interval ~every 3 years (PN 32214958) regardless of low mileage. Service 6 often includes fuel 32242191 and engine oil.",
    body_md_en:
      "## Summary\n\nBrake fluid **XC60 II** is calendar-based.\n\n## PN\n\n- Fluid Volvo **32214958** (~0.8 L)\n- Fuel if due **32242191**\n\n## Important\n\nLow annual km does not skip fluid by age.",
  },
  "spa-xc60-fluids-brakes-52k": {
    title_en: "SPA XC60 II: AWD fluids + brakes at 52k km",
    summary_en:
      "Package: ATF ZIC 162665, Haldex Ravenol, angle/rear Mannol + ring 11998, fluid; front Gparts VO31665446 / Brembo P86028, rear Zekkert / P86030.",
    body_md_en:
      "## Summary\n\nFull AWD fluids and brakes **XC60 II**.\n\n## PN (log)\n\n- ATF ZIC **162665**\n- Haldex Ravenol **1211140001**\n- Angle/rear Mannol **1304** + ring Volvo **11998**\n- Front disc Gparts **VO31665446**, pads Brembo **P86028**\n- Rear Zekkert **BS-6596**, Brembo **P86030**\n\n## Important\n\n17″/16″ discs not universal. VIN!",
  },
  "spa-xc60ii-service-brakes-plugs": {
    title_en: "SPA XC60 II: plugs ZXE24HLR7 and pads 32373124",
    summary_en:
      "Major service: filter 32140029, air 31370089, cabin CUK34003, plugs ZXE24HLR7, front 32373124 / disc 31471752.",
    body_md_en:
      "## Summary\n\nService package **XC60 II**.\n\n## PN\n\n- Plugs **ZXE24HLR7**\n- Front pads **32373124**\n- Front disc **31471752**\n- Rear ref **32379535**\n\n## ATF\n\nOften together: Toyota WS **0888602305**, cooler rings **31437023**, fluid **32214958**.\n\n## Important\n\n17″/18″ discs — different PN.",
  },
  "spa-xc60ii-timing-atf-haldex": {
    title_en: "SPA XC60 II: timing + ATF + Haldex fluid",
    summary_en:
      "XC60 II diesel 2018 one visit: timing/accessory belt kit, full ATF and Haldex fluid (OEM refs in post).",
    body_md_en:
      "## Summary\n\nMajor **XC60 II (SPA)** visit: timing + trans + Haldex.\n\n## Part numbers (log)\n\n- Timing belt kit **32298420**\n- Haldex fluid **31209623** / **31367940**\n\n## Important\n\nVIN/EPC. Haldex often needs programmed bleed. Drive2 summary.",
  },
  "spa-xc90-agm-banner-92": {
    title_en: "SPA XC90: AGM Banner 92 Ah for Webasto",
    summary_en:
      "Stock 80 Ah AGM starts at −25 but Webasto drops on charge. Higher-capacity AGM (e.g. Banner 92 Ah) + charger; watch auxiliary heater afterward.",
    body_md_en:
      "## Summary\n\nMain battery capacity matters for **Webasto** on **XC90 II**.\n\n## Procedure\n\nFull charge on quality charger first; if Webasto still quits — higher Ah AGM in same case size.\n\n## Important\n\nBMS registration/reset via diagnostics after.",
  },
  "spa-xc90-aux-battery-bosch": {
    title_en: "SPA XC90: auxiliary battery — Bosch M6 019",
    summary_en:
      "Start/Stop battery fault on XC90 II: replace small battery; motorcycle cross much cheaper. Example Bosch M6 019 dry charged.",
    body_md_en:
      "## Summary\n\nAuxiliary battery **XC90 II**.\n\n## Procedure\n\nFault may not stop driving but affects Start/Stop and messages. AGM motorcycle format common.\n\n## Important\n\nNon-OEM terminals differ — plan hardware.",
  },
  "spa-xc90-aux-battery-diy": {
    title_en: "SPA XC90: auxiliary battery DIY",
    summary_en:
      "Cover at strut → negative, then positive → lift out. Reverse to install. Thinner/lighter aftermarket same Ah — terminal bolts may be short.",
    body_md_en:
      "## Summary\n\nDIY aux battery **XC90 II**.\n\n## Procedure\n\nTerminal order matters. Battery often loose in tray — secure it.\n\n## Important\n\nIf fault remains — full cycle with main battery and BCSM (see XC60 note).",
  },
  "spa-xc90-battery-exide-95": {
    title_en: "SPA XC90: main battery — size vs VIN",
    summary_en:
      "Webasto drains main battery. VIN may list “XC60-like” battery; 95 Ah tray may fit but retainer may not (strap workaround).",
    body_md_en:
      "## Summary\n\nMain battery **XC90 II**.\n\n## Procedure\n\nMatch **VIN**, not model name alone. Exide/OEM by tray and posts.\n\n## Important\n\nRetainer and lid height must match; strap is not a long-term fix.",
  },
  "spa-xc90-brake-fluid-atf-partial": {
    title_en: "SPA XC90: Bosch ENV6 fluid + partial ATF",
    summary_en:
      "Mid-interval: brake Bosch ENV6 (1 987 479 207), partial ATF drain (~2.5 L still clean). Oil Hengst E217H D310.",
    body_md_en:
      "## Summary\n\nFluid by age (~2 years) and ATF check **XC90 II**.\n\n## PN\n\n- Fluid Bosch **ENV6** 1 987 479 207\n- Oil filter Hengst **E217H D310**\n\n## Important\n\nMany change fluid by calendar despite tester readings.",
  },
  "spa-xc90-diesel-fuel-filter-febi": {
    title_en: "SPA XC90 D5: fuel filter 32312226 / Febi 174039",
    summary_en:
      "Diesel XC90 II fuel OEM 32312226; crosses Febi 174039, Blue Print ADBP230026, Vaico V95-0583. Air/oil Filtron or MANN as available.",
    body_md_en:
      "## Summary\n\nDiesel fuel filter **SPA XC90**.\n\n## PN\n\n- OEM **32312226**\n- Febi **174039** / Blue Print **ADBP230026** / Vaico **V95-0583**\n\n## Important\n\nPetrol SPA uses different numbers.",
  },
  "spa-xc90-front-lca": {
    title_en: "SPA XC90: front lower control arms",
    summary_en:
      "XC90 II front lower arms in assembly (OEM costly; Korean/Chinese alternatives exist). Alignment after. Check ball joints before install.",
    body_md_en:
      "## Summary\n\nFront lower arms **XC90 II**.\n\n## Procedure\n\nCheck ball joint: snap ring, grease, stud play. OEM vs aftermarket differ on swaging.\n\n## Important\n\nAlignment required.",
  },
  "spa-xc90-rear-pads-skf-fuel-32312226": {
    title_en: "SPA XC90 II: rear pads SKF + fuel 32312226",
    summary_en:
      "XC90 II diesel rear squeal: rear pads (e.g. SKF VKBP90142) plus planned fuel filter OEM 32312226.",
    body_md_en:
      "## Summary\n\nInner rear pads to metal + scheduled fuel filter.\n\n## Part numbers\n\n- Pads SKF **VKBP90142**\n- Fuel OEM **32312226**\n\n## Important\n\nDrive2 summary.",
  },
  "spa-xc90-t8-brakes-atf-haldex": {
    title_en: "SPA XC90: T8-size brakes + ATF and Haldex",
    summary_en:
      "XC90 II upgraded to T8 disc sizes (19″/18″ vs 18″/17″). Often ~8 L ATF exchange and Haldex teardown — pump strainer.",
    body_md_en:
      "## Summary\n\n“T8 brakes” + trans service **XC90 II**.\n\n## Procedure\n\n- Larger discs than T5/D5 — verify calipers.\n- Auto: two drains, ~**8 L** around 60k km.\n- Haldex: fluid looks clean but tar in sump — clean strainer.\n\n## Important\n\nAngle gear fluid often deferred to next trans service (~100k km).",
  },
  "spa-xc90-to4-atf-coolant-haldex": {
    title_en: "SPA XC90 II: service 4 — ATF, coolant, Haldex, filters",
    summary_en:
      "XC90 II petrol service 4: ATF, coolant, Haldex, filters (Mann + fuel Mahle KL1055) and pads.",
    body_md_en:
      "## Summary\n\nFull **XC90 II** service: engine, trans, coolant, Haldex, filters, pads.\n\n## Filters (example)\n\n- Cabin Mann **CUK 34003**\n- Oil Mann **HU 8014 Z**\n- Air Mann **C 29021**\n- Fuel Mahle **KL 1055**\n\n## Important\n\nVIN. Drive2 summary.",
  },
  "spa-xc90-to60-filters": {
    title_en: "SPA XC90 II: ~60k km service — 32140029 / KL1055",
    summary_en:
      "Oil Volvo 32140029, fuel Mahle KL1055, service reset via V-tool; plugs checked each service.",
    body_md_en:
      "## Summary\n\nMid service **XC90 II**.\n\n## PN\n\n- Oil **32140029**\n- Fuel **KL1055**\n\n## Important\n\nFill volume ~5.5 L — verify dipstick/sensor.",
  },
};
