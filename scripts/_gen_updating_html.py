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
      gap: 1.25rem;
    }}
    .maintenance-brand {{
      margin: 0;
      font-size: clamp(1.75rem, 5vw, 2.35rem);
      font-weight: 700;
      letter-spacing: 0.14em;
      color: var(--accent);
      text-transform: uppercase;
    }}
    .maintenance-car {{
      display: block;
      width: min(100%, 26rem);
      aspect-ratio: 475 / 345;
      margin: 0.35rem 0 0.15rem;
      color: var(--accent);
      opacity: 0.9;
      animation:
        maintenance-car-in 0.9s ease-out both,
        maintenance-car-idle 4.5s ease-in-out 0.9s infinite;
    }}
    .maintenance-car svg {{
      width: 100%;
      height: 100%;
      display: block;
    }}
    .maintenance-msg {{
      margin: 0;
      font-size: clamp(0.95rem, 2.6vw, 1.1rem);
      line-height: 1.45;
      color: var(--text-muted);
      letter-spacing: 0.02em;
    }}
    @keyframes maintenance-car-in {{
      from {{ opacity: 0; transform: translateY(12px); }}
      to {{ opacity: 0.9; transform: translateY(0); }}
    }}
    @keyframes maintenance-car-idle {{
      0%, 100% {{ transform: translateY(0); opacity: 0.88; }}
      50% {{ transform: translateY(-6px); opacity: 1; }}
    }}
    @media (prefers-reduced-motion: reduce) {{
      .maintenance-car {{ animation: none; opacity: 0.9; }}
    }}
  </style>
</head>
<body>
  <main class="maintenance-page">
    <div class="maintenance-inner">
      <h1 class="maintenance-brand">VOLVO EWD</h1>
      <div class="maintenance-car" role="img" aria-label="Volvo V70 / XC70 / S80">
{svg}
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
