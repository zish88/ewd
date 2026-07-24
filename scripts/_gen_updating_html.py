"""Generate self-contained client/public/updating.html from maintenance-volvo.svg."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
svg = (ROOT / "client/public/maintenance-volvo.svg").read_text(encoding="utf-8")
if svg.startswith("<?xml"):
    svg = svg.split("?>", 1)[1].strip()
svg = svg.replace('stroke="#FFFFFF"', 'stroke="currentColor"')
svg = svg.replace("stroke='#FFFFFF'", "stroke='currentColor'")

html = f"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta http-equiv="refresh" content="15" />
  <meta name="theme-color" content="#0f172a" />
  <meta name="robots" content="noindex" />
  <title>Volvo EWD · обновление</title>
  <style>
    :root {{
      --bg-main: #0f172a;
      --accent: #34d399;
      --text-muted: #94a3b8;
      --safe-bottom: env(safe-area-inset-bottom, 0px);
      --safe-top: env(safe-area-inset-top, 0px);
      --dash: 40px;
    }}
    * {{ box-sizing: border-box; }}
    html, body {{
      margin: 0;
      min-height: 100%;
      background: var(--bg-main);
      color: #f8fafc;
      font-family: "Segoe UI", Candara, "Gill Sans", "Trebuchet MS", sans-serif;
    }}
    .maintenance-page {{
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: calc(2rem + var(--safe-top)) 1.25rem calc(2rem + var(--safe-bottom));
      background:
        radial-gradient(ellipse 80% 55% at 50% 28%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 70%),
        var(--bg-main);
    }}
    .maintenance-inner {{
      width: min(100%, 28rem);
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.1rem;
    }}
    .maintenance-brand {{
      margin: 0;
      font-size: clamp(1.75rem, 5vw, 2.35rem);
      font-weight: 700;
      letter-spacing: 0.14em;
      color: var(--accent);
      text-transform: uppercase;
    }}
    /* Scene: road scrolls under the car → «едет» без скачка цикла */
    .drive-scene {{
      width: min(100%, 26rem);
      margin: 0.2rem 0 0.1rem;
      overflow: hidden;
      animation: scene-fade-in 0.85s ease-out both;
    }}
    .drive-car {{
      display: block;
      width: 100%;
      aspect-ratio: 475 / 345;
      color: var(--accent);
      opacity: 0.92;
      will-change: transform;
      animation: car-cruise 4.8s ease-in-out infinite;
    }}
    .drive-car svg {{
      width: 100%;
      height: 100%;
      display: block;
    }}
    .drive-road {{
      position: relative;
      height: 10px;
      margin: -0.35rem 8% 0;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 12%, #0b1220);
      overflow: hidden;
      box-shadow: 0 0 18px color-mix(in srgb, var(--accent) 18%, transparent);
    }}
    .drive-road__dashes {{
      position: absolute;
      inset: 3px -var(--dash) 3px 0;
      background: repeating-linear-gradient(
        90deg,
        var(--accent) 0 18px,
        transparent 18px var(--dash)
      );
      opacity: 0.55;
      will-change: transform;
      animation: road-scroll 0.9s linear infinite;
    }}
    .maintenance-msg {{
      margin: 0;
      font-size: clamp(0.95rem, 2.6vw, 1.1rem);
      line-height: 1.45;
      color: var(--text-muted);
      letter-spacing: 0.02em;
    }}
    @keyframes scene-fade-in {{
      from {{ opacity: 0; transform: translateY(10px); }}
      to {{ opacity: 1; transform: translateY(0); }}
    }}
    /* 0% === 100% → бесшовный цикл, без прыжка */
    @keyframes car-cruise {{
      0%, 100% {{ transform: translate3d(-12px, 0, 0) rotate(-0.6deg); }}
      50% {{ transform: translate3d(12px, -3px, 0) rotate(0.6deg); }}
    }}
    @keyframes road-scroll {{
      from {{ transform: translate3d(0, 0, 0); }}
      to {{ transform: translate3d(calc(-1 * var(--dash)), 0, 0); }}
    }}
    @media (prefers-reduced-motion: reduce) {{
      .drive-scene {{ animation: none; }}
      .drive-car,
      .drive-road__dashes {{ animation: none; }}
    }}
  </style>
</head>
<body>
  <main class="maintenance-page">
    <div class="maintenance-inner">
      <h1 class="maintenance-brand">VOLVO EWD</h1>
      <div class="drive-scene" role="img" aria-label="Volvo V70 / XC70 / S80">
        <div class="drive-car">
{svg}
        </div>
        <div class="drive-road" aria-hidden="true">
          <div class="drive-road__dashes"></div>
        </div>
      </div>
      <p class="maintenance-msg">сайт на обновлении</p>
    </div>
  </main>
</body>
</html>
"""

out = ROOT / "client/public/updating.html"
out.write_text(html, encoding="utf-8")
print(f"wrote {out} ({out.stat().st_size} bytes)")
