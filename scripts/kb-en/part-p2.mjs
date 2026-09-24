/** @type {Record<string, { title_en: string; summary_en: string; body_md_en: string }>} */
export const partP2 = {
  "p2-abs-lamp-checklist": {
    title_en: "P2: ABS lamp on — where to start",
    summary_en:
      "P2 ABS lamp is often a wheel sensor, wiring or tone ring. Read the code (e.g. BCM), check the connector and harness before replacing an expensive module.",
    body_md_en:
      "## Summary\n\nOn **P2**, ABS/TRACS often needs a **sensor** or wiring, not a new “brain”.\n\n## Checklist\n\n1. Read codes (scanner / DiCE), note the wheel.\n2. Inspect sensor connector and harness for breaks.\n3. Check tone ring on CV joint (dirt, cracks).\n4. Replace sensor only after locating the side.\n\n## Important\n\nOrientation only, not a wiring diagram. No P2 EWD on this site — see the author's post. Verify sensor PN via VIN.",
  },
  "p2-ac-pressure-switch": {
    title_en: "P2: A/C won't engage — pressure switch",
    summary_en:
      "P2 A/C compressor won't start on low/high refrigerant pressure or a dead line sensor. Gauges first, then clutch electrical.",
    body_md_en:
      "## Summary\n\nClimate disables the compressor via **pressure switch** and clutch power.\n\n## Procedure\n\n1. Gauges — refrigerant in range.\n2. Line sensor connector — corrosion.\n3. Clutch power when A/C is requested.\n4. A/C relay/fuse.\n\n## Important\n\nTopping up “by feel” without scales and leak check leads to repeat failure.",
  },
  "p2-alternator-bearings-ps-seal": {
    title_en: "P2 S60: alternator bearings + PS pump seal",
    summary_en:
      "Alternator comes out upward after the fan; often replace the PS pump seal (major leak).",
    body_md_en:
      "## Summary\n\nAlternator and PS pump work on **S60 P2**.\n\n## Procedure\n\nBattery → fan → belt → PS pump → lift alternator out. PS seal — 4 Torx bolts.\n\n## Important\n\nBleed PS without air afterward.",
  },
  "p2-alternator-pn": {
    title_en: "P2: telling alternators apart by part number",
    summary_en:
      "Read the PN on the housing and match EPC/aftermarket — P2 often mixes Bosch and Valeo.",
    body_md_en:
      "## Summary\n\nP2 (S60/V70/XC70 ~2000–2007) Bosch and Valeo alternators are **not interchangeable** on mounts and plug, even if amperage is similar.\n\n## Steps\n\n1. Read PN from the case (not the aftermarket box).\n2. Match EPC by VIN or a verified same-generation PN.\n3. Check power/excitation pins — plug shape differs.\n\nOrientation only, not a full compatibility table.",
  },
  "p2-alternator-replace-gates": {
    title_en: "P2 S60: top alternator swap + Gates belt",
    summary_en:
      "Bearing/overrun noise: alternator out from top after fan; Gates belt 6DPK1838 and INA 531076010 idler.",
    body_md_en:
      "## Summary\n\nAlternator replacement on **S60 P2** from above.\n\n## Procedure\n\nRemove fan → belt → bolts past compressor → lift out.\n\n## Related PN\n\n- Belt Gates **6DPK1838**\n- Idler INA/LUK **531076010**\n\n## Important\n\nCheck overrun pulley separately.",
  },
  "p2-battery-30659798": {
    title_en: "P2: battery Volvo 30659798 70 Ah",
    summary_en:
      "Common P2 size: Volvo 30659798 — 70 Ah, 600 A, reverse polarity.",
    body_md_en:
      "## Summary\n\nBattery selection for **S60/V70 P2**.\n\n## Reference\n\n- OEM **30659798**\n- ~70 Ah / 600 A / reverse polarity\n\n## Important\n\nR/options may differ. VIN!",
  },
  "p2-brake-substitutes-ate": {
    title_en: "P2: brake aftermarket — ATE/Brembo/TRW",
    summary_en:
      "Disc/pad picks and ATE SL.6 fluid; parking brake cables and shoes separate.",
    body_md_en:
      "## Summary\n\nBrake brand choice on **S60 1G**.\n\n## Procedure\n\nOften **ATE**; fluid ref **ATE SL.6** (DOT4). Parking brake — cables + shoes separately.\n\n## Important\n\nHose lengths differ front/rear.",
  },
  "p2-brakes-round-s60": {
    title_en: "P2 S60: brakes all around and 305 mm discs",
    summary_en:
      "S60 1G full brake refresh; 305 mm front needs different caliper carriers. Often OEM front + ATE rear.",
    body_md_en:
      "## Summary\n\nFull brake rebuild **S60 P2**.\n\n## Procedure\n\nClean/paint calipers, pistons and boots as needed. 305 mm — carrier swap.\n\n## Important\n\nDisc size depends on equipment.",
  },
  "p2-coolant-tank-hose": {
    title_en: "P2 XC70 II: coolant tank 30741973 and hoses",
    summary_en:
      "Tank leaks: OEM 30741973, hose 30680923, Wahler 4272.90D thermostat, upper hose Gates 02-2251.",
    body_md_en:
      "## Summary\n\nAging cooling on **XC70 II / P2**.\n\n## PN\n\n- Tank **30741973**\n- Hose **30680923**\n- Thermostat **Wahler 4272.90D**\n- Hose Gates **02-2251**\n\n## Important\n\nFlush + fresh coolant.",
  },
  "p2-filters-purflux-set": {
    title_en: "P2: Purflux filters for routine service",
    summary_en:
      "S60 1G: oil Purflux L316, air A1144, cabin AHC173.",
    body_md_en:
      "## Summary\n\nBasic **P2** service: oil + three filters.\n\n## PN\n\n- **Purflux L316** / **A1144** / **AHC173**\n\n## Important\n\nVerify OEM crosses.",
  },
  "p2-fog-lamp-socket": {
    title_en: "P2: fog lamps — socket, insulator, bulbs",
    summary_en:
      "Restore halogen fogs on P2: socket 30795072, insulator 979041, pins 30656688, bulbs like OSRAM 64150.",
    body_md_en:
      "## Summary\n\nOn **S60/V70 P2** after HID “hacks” in fogs, owners restore halogen: **socket**, **insulator**, proper **bulbs**.\n\n## Part numbers\n\n- Socket: **30795072**\n- Insulator: **979041**\n- Contact pins: **30656688**\n- Bulbs (log example): **OSRAM 64150** / CBI — confirm base for your housing\n\nHeadlamp washer refresh (pump **81439800**, filter **30649801**) is adjacent work.\n\n## Important\n\nNo HID in reflector without lens/washer — legal and glare issues. Verify PN via **VIN**. Drive2 summary.",
  },
  "p2-fuel-pump-relay-cem": {
    title_en: "P2: no fuel pressure — relay and CEM",
    summary_en:
      "S60/V70 P2 no-start/no pressure is often fuel pump relay or CEM/ECM command. Listen for relay click, check pump power before dropping the tank.",
    body_md_en:
      "## Summary\n\nP2 fuel pump is controlled via relay/CEM. “Empty tank” symptoms ≠ dead pump.\n\n## Checklist\n\n1. Rail pressure / pump prime on key-on.\n2. Pump relay and fuse.\n3. Power at pump connector.\n4. ECM codes (fuel / immobilizer).\n\n## Important\n\nImmobilizer also cuts the pump — do not skip key/antenna.",
  },
  "p2-lambda-denso-dox": {
    title_en: "P2 S60: Denso lambda — DOX-0410/0412/1419",
    summary_en:
      "B5244S has three regulator sensor variants by VIN/chassis: DOX-0410, DOX-0412, DOX-1419. OEM confusion is common.",
    body_md_en:
      "## Summary\n\nLambda selection on **S60 P2** 2.4 NA.\n\n## References\n\n- DOX-0410 / OEM **8627599** (US market / S6)\n- DOX-0412 / **8658237** (chassis from ~235108)\n- DOX-1419 / **9497252** (chassis to ~235107)\n\n## Important\n\nVIN + cable length only.",
  },
  "p2-o2-sensor-denso-0402": {
    title_en: "P2 S60: rear lambda OEM 30622252 → Denso DOX-0402",
    summary_en:
      "Check engine on rear heated O2: OEM 30622252, common cross Denso DOX-0402.",
    body_md_en:
      "## Summary\n\nRear lambda on **S60 P2**.\n\n## PN\n\n- OEM **30622252**\n- Denso **DOX-0402**\n\n## Important\n\nMultiple numbers per year/chassis in EPC — verify.",
  },
  "p2-oem-filters-9454647": {
    title_en: "P2: OEM filters 9454647 / 30630754 / 1275810",
    summary_en:
      "Full petrol S60 1G service: oil 1275810, air 9454647, cabin 30630754, fuel 32242189, plugs 8642660.",
    body_md_en:
      "## Summary\n\nOEM cheat sheet for **P2 petrol**.\n\n## List\n\n- Oil **1275810**\n- Air **9454647**\n- Cabin **30630754**\n- Fuel **32242189**\n- Plugs **8642660**\n\n## Important\n\nDiesel uses different numbers.",
  },
  "p2-pcv-breather-whiteblock": {
    title_en: "P2: PCV / oil separator whiteblock",
    summary_en:
      "Oil misting, consumption and whistle on petrol P2 — often PCV/oil trap in the valve cover or housing. Kits exist without replacing the whole cover.",
    body_md_en:
      "## Summary\n\nWhiteblock crankcase ventilation ages and clogs.\n\n## Procedure\n\n1. Inspect brittle PCV hoses.\n2. Oil trap — clean or kit.\n3. Crankcase pressure (blows dipstick out?).\n4. Short oil service after.\n\n## Important\n\nIgnoring PCV = seals and oil consumption.",
  },
  "p2-pscm-steering-angle": {
    title_en: "P2: steering angle fault / DSTC after work",
    summary_en:
      "After alignment or steering wheel removal on P2 you often need steering angle calibration. Without it DSTC/ABS fault. Dealer or compatible scanner.",
    body_md_en:
      "## Summary\n\n**P2** stability uses steering angle. Steering work resets calibration.\n\n## Procedure\n\n1. Read BCM/ABS/DSTC codes.\n2. If “steering angle” / “calibration” — calibrate on level ground.\n3. Check connector under wheel and clock spring after airbag work.\n\n## Important\n\nClearing codes without calibration brings the lamp back.",
  },
  "p2-spark-plugs-8642660": {
    title_en: "P2 S60: plugs OEM 8642660 + Zimmermann brakes",
    summary_en:
      "Petrol S60 1G major service: plugs 8642660 (Beru Z204) and often Zimmermann discs/pads front/rear.",
    body_md_en:
      "## Summary\n\n**S60/V70 P2** petrol: plugs + brakes in one visit.\n\n## PN\n\n- Plugs **8642660** / Beru **Z204**\n- Zimmermann front disc **610.3701.20**, pads **23073.190.1**\n- Rear **610.3703.20** / **23076.175.1**\n\n## Important\n\nDisc size by options.",
  },
  "p2-stop-lamp-relay": {
    title_en: "P2: stop lamp fault — relay, not the bulb",
    summary_en:
      "V70 II: bulb OK but warning on — often combined stop/fog relay (OEM 9441161/9441181). Replaced with single Bosch relays.",
    body_md_en:
      "## Summary\n\nOn **P2** (e.g. V70 II) stop-lamp message with good bulbs is often a **relay**, not the socket.\n\n## Part numbers\n\n- Stock (from log): **9441161**, **9441181**\n- Single Bosch replacement (example): **0986332021**\n\n## Procedure\n\nCheck bulbs and contacts first, then relay box. Stock dual relay is often non-serviceable.\n\n## Important\n\nPinout varies by body. Drive2 summary.",
  },
  "p2-thermostat-facet-coolant": {
    title_en: "P2 S60: Facet 78606 thermostat + coolant 31439724",
    summary_en:
      "Winter: weak heat / slow gauge — Facet 78606, Volvo coolant 31439724, bolts 986228.",
    body_md_en:
      "## Summary\n\nThermostat and coolant on **S60 P2**.\n\n## PN\n\n- Thermostat **Facet 78606**\n- Coolant Volvo **31439724**\n- Bolts **986228**\n\n## Important\n\nOEM housing is costly — choose insert/housing crosses deliberately.",
  },
  "p2-thermostat-gates-insert": {
    title_en: "P2: Gates thermostat insert TH35991",
    summary_en:
      "Hunting temperature on the highway — Gates TH35991 insert and gasket VO31293699GA.",
    body_md_en:
      "## Summary\n\nFloating temp — classic dead thermostat on **P2**.\n\n## PN\n\n- Insert **Gates TH35991**\n- Gasket **VO31293699GA**\n\n## Important\n\nNot the full OEM housing.",
  },
  "p2-thermostat-insert-v70": {
    title_en: "P2 V70: thermostat insert only",
    summary_en:
      "Restyled V70 II motors: full housing is expensive; owners find the correct insert and swap with a coolant drain.",
    body_md_en:
      "## Summary\n\nSave money: insert instead of housing on **V70 II**.\n\n## Procedure\n\nWheel/belt off, drain coolant, do not mix up insert PN.\n\n## Important\n\nWrong store insert is a common mistake.",
  },
  "p2-throttle-body-clean": {
    title_en: "P2: unstable idle — throttle body clean",
    summary_en:
      "Petrol P2 carbon on the throttle plate causes hunting idle and adaptation faults. Clean + scanner adaptation is often cheaper than a new body.",
    body_md_en:
      "## Summary\n\nElectronic throttle plates foul — engine hunts idle.\n\n## Procedure\n\n1. Remove duct, open plate carefully.\n2. Throttle cleaner, do not force the mechanism.\n3. Idle/throttle adaptation after reassembly.\n4. Check vacuum lines and DCV.\n\n## Important\n\nDrive play or sensor fault — cleaning won't fix; replace the unit.",
  },
  "p2-timing-belt-whiteblock": {
    title_en: "P2 petrol: whiteblock timing belt — kit and signs",
    summary_en:
      "P2 five-cylinder petrol (whiteblock): belt + rollers + pump. Whine/coolant leak at pump — do not wait for interval. Gates/INA/OEM kit per engine.",
    body_md_en:
      "## Summary\n\nPetrol **P2** with timing belt needs planned kit replacement.\n\n## Procedure\n\n- Do not skip the pump with the belt.\n- Watch coolant seep at pump and roller play.\n- Bleed cooling without air locks after.\n\n## Important\n\nInterval depends on engine and market; check VIDA.",
  },
  "p2-v70-abs-ring-springs": {
    title_en: "P2 V70: ABS ring Metzger + Lesjöfors springs",
    summary_en:
      "ABS drop-out >50 km/h on V70 II is often a cracked tone ring (Metzger 0900164); Lesjöfors 4095837 springs fitted at the same time.",
    body_md_en:
      "## Summary\n\nABS sensor fault + sagging springs on **V70 II**.\n\n## Part numbers\n\n- ABS ring: Metzger **0900164**\n- Springs: Lesjöfors **4095837** (example from XC70 D5)\n\n## Important\n\nRusty hub crushes the ring. Drive2 summary.",
  },
  "p2-vkg-thermostat-ac-rad": {
    title_en: "P2 V70: timing belt, Wahler thermostat, A/C radiator",
    summary_en:
      "Job bundle: timing belt, Wahler 481890D thermostat housing, A/C condenser, alternator overrun pulley.",
    body_md_en:
      "## Summary\n\nAge-related bundle on **V70 II**.\n\n## PN\n\n- Thermostat housing Wahler **481890D**\n\n## Important\n\nFan always on — check A/C/radiator.",
  },
  "p2-washer-pump": {
    title_en: "P2: windshield washer pump — typical PN",
    summary_en:
      "Winter: wrong spray pattern often means pump or nozzles. S60/V70 P2 — check OEM pump and jet numbers.",
    body_md_en:
      "## Summary\n\nOn **P2** (~2000–2007) a common winter story: windshield washer weak while headlamp washer still works — or the reverse. Often **pump** and/or **jets**.\n\n## Part numbers (owner logs)\n\n- Jets / related OEM: **30655606** and neighbors — verify in EPC.\n- Pump: by VIN; “universal” pumps often wrong plug/bracket.\n\n## Procedure\n\nPump access via reservoir in arch/liner (body-dependent). Test both circuits after replacement.\n\n## Important\n\n**Verify PN via VIN.** Drive2 hint, not a full catalog.",
  },
  "p2-washer-pumps-mapco": {
    title_en: "P2 S60: windshield and headlamp washer pumps",
    summary_en:
      "Winter kills both pumps. Crosses like MAPCO 90604 / MEYLE 3130670001; headlamp pump needs bumper removal.",
    body_md_en:
      "## Summary\n\nTwo pumps in the **S60 P2** reservoir: windshield and headlamps.\n\n## Procedure\n\nDrain fluid, swap windshield pump without bumper; headlamp pump — bumper and careful with the connector.\n\n## Important\n\nHeadlamp quick-connect hose is often one-time use.",
  },
  "p2-xc70-abs-rings-febi-hubs": {
    title_en: "P2 XC70: FEBI ABS rings when replacing hubs",
    summary_en:
      "Front hub replacement on XC70 II: fit FEBI 100751 tone rings; heat for install, do not hit the teeth.",
    body_md_en:
      "## Summary\n\nABS ring prevention on **XC70 II** drives.\n\n## Part numbers\n\n- Ring: FEBI **100751**\n\n## Procedure\n\nCareful hammer removal; heated install, drive on wood block.\n\n## Important\n\nDrive2 summary.",
  },
  "p2-xc70-alternator-overrun-pulley-ina": {
    title_en: "P2 XC70: alternator overrun pulley INA 535007210",
    summary_en:
      "Rustle/whistle cold is often a seized alternator overrun pulley; common cross INA 535007210.",
    body_md_en:
      "## Summary\n\nTypical **XC70 II / V70 II** issue — alternator overrun (freewheel) pulley.\n\n## Part numbers\n\n- INA **535007210**\n\n## Procedure\n\nSeized pulley won't freewheel; often replace belt/idlers and PS fluid too.\n\n## Important\n\nDrive2 summary.",
  },
  "p2-xc70-alternator-rebuild-bearings": {
    title_en: "P2 XC70: alternator rebuild — pulley, bearings, brushes",
    summary_en:
      "Cold belt squeal: owners rebuild alternator — overrun pulley, bearings, rings, regulator.",
    body_md_en:
      "## Summary\n\nRebuild alternator on **XC70 II** instead of new unit.\n\n## Procedure\n\nTop removal (intercooler/radiator hoses); special tools on pulley; ~14 V charge after assembly.\n\n## Important\n\nDrive2 summary.",
  },
  "p2-xc70-brakes-ate-service": {
    title_en: "P2 XC70: front ATE brake service",
    summary_en:
      "ATE guides 11.8171-0008.1, kit 11.0441-6008.2, pads 13.0470-7145.2, disc 24.0128-0123.1; use long bleeder 03.3518-1900.2.",
    body_md_en:
      "## Summary\n\nFront ATE brake overhaul **XC70 II**.\n\n## PN\n\n- Pads **13.0470-7145.2**\n- Disc **24.0128-0123.1**\n- Bleeder **03.3518-1900.2** (short won't fit)\n\n## Important\n\nRear size sometimes taken from XC90 — verify.",
  },
  "p2-xc70-filters-denso-spark": {
    title_en: "P2 XC70: filters + Denso IK20 plugs",
    summary_en:
      "After purchase: Denso IK20, Hengst E15HD58, Filtron AP1652, ALCO SP2145, cabin TSN 97252; fuel quick-connect clips often dead.",
    body_md_en:
      "## Summary\n\nFirst service after buying **XC70 II**.\n\n## PN\n\n- Plugs **Denso IK20**\n- Oil Hengst **E15HD58**\n- Air Filtron **AP1652**\n- Fuel ALCO **SP2145**\n\n## Important\n\nHave fuel line clips/clamps ready.",
  },
  "p2-xc70-oil-thermostat-gparts": {
    title_en: "P2 XC70: oil + GParts thermostat insert",
    summary_en:
      "High-mile XC70 II: oil filter 1275810, insert VO31293699TH; PS pump removal eases insert install.",
    body_md_en:
      "## Summary\n\nOil service + thermostat on **XC70 II**.\n\n## PN\n\n- Oil **1275810**\n- Insert **VO31293699TH**\n\n## Procedure\n\nInsert is easier with PS pump off.",
  },
  "p2-xc70-psf-pump-replace": {
    title_en: "P2 XC70: PS pump and fluid replacement",
    summary_en:
      "XC70 II “replace pump” advice often stops at fluid; if replacing pump, check relief valve on housing.",
    body_md_en:
      "## Summary\n\nPS service on **XC70 II**: fluid ± pump.\n\n## Procedure\n\nStock pump may be quiet for years with dirty pulley; new pumps sometimes have undertightened valve — check before install.\n\n## Important\n\nDrive2 summary.",
  },
  "p2-xc70-steering-rack-bushings": {
    title_en: "P2 XC70: rack overhaul + SKF control arm bushings",
    summary_en:
      "Steering play/clicks on XC70 II — rack rebuild (shaft), Lemförder tie rods; front arm bushings SKF VKDS 336022/336023.",
    body_md_en:
      "## Summary\n\nSteering + front arms on **XC70 II**.\n\n## Part numbers\n\n- Bushings: SKF **VKDS 336022**, **VKDS 336023**\n\n## Important\n\nXC90 vs XC70 rack tie rod compatibility — check. Drive2 summary.",
  },
};
