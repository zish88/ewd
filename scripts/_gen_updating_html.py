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
      --safe-bottom: env(safe-area-inset-bottom, 0px);
      --safe-top: env(safe-area-inset-top, 0px);
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
      will-change: opacity, text-shadow;
      animation: brand-pulse 4s ease-in-out infinite;
    }}
    /* Края силуэта растворяются; центр чёткий (не filter:blur всей картинки) */
    .drive-scene {{
      width: min(100%, 26rem);
      margin: 0.2rem 0 0.1rem;
      overflow: hidden;
      -webkit-mask-image: radial-gradient(ellipse 72% 68% at 50% 48%, #000 42%, transparent 78%);
      mask-image: radial-gradient(ellipse 72% 68% at 50% 48%, #000 42%, transparent 78%);
      -webkit-mask-repeat: no-repeat;
      mask-repeat: no-repeat;
      animation: scene-fade-in 0.85s ease-out both;
    }}
    .drive-car {{
      display: block;
      width: 100%;
      aspect-ratio: 475 / 345;
      color: var(--accent);
      opacity: 0.92;
      will-change: transform;
      animation: car-cruise 7.5s ease-in-out infinite;
    }}
    .drive-car svg {{
      width: 100%;
      height: 100%;
      display: block;
    }}
    .maintenance-msg {{
      margin: 0;
      font-size: clamp(0.95rem, 2.6vw, 1.1rem);
      line-height: 1.45;
      letter-spacing: 0.02em;
      color: var(--accent);
      text-shadow:
        0 0 18px rgba(251, 146, 60, 0.45),
        0 0 36px rgba(239, 68, 68, 0.28);
    }}
    @keyframes scene-fade-in {{
      from {{ opacity: 0; transform: translateY(8px); }}
      to {{ opacity: 1; transform: translateY(0); }}
    }}
    @keyframes brand-pulse {{
      0%, 100% {{
        opacity: 0.88;
        text-shadow: 0 0 12px color-mix(in srgb, var(--accent) 25%, transparent);
      }}
      50% {{
        opacity: 1;
        text-shadow: 0 0 22px color-mix(in srgb, var(--accent) 55%, transparent);
      }}
    }}
    /* 0% === 100% → бесшовный цикл */
    @keyframes car-cruise {{
      0%, 100% {{
        transform: translate3d(-6px, 0, 0) rotate(-0.25deg);
        opacity: 0.9;
      }}
      50% {{
        transform: translate3d(6px, -2px, 0) rotate(0.25deg);
        opacity: 0.95;
      }}
    }}
    @media (prefers-reduced-motion: reduce) {{
      .drive-scene,
      .drive-car,
      .maintenance-brand {{ animation: none; }}
      .maintenance-brand {{ opacity: 1; }}
      .drive-car {{ opacity: 0.92; }}
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
