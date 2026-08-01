# Telegram Mini App

The app stays available at its ordinary HTTPS URL. Telegram opens that same URL
inside its Mini App WebView; no separate frontend deployment is required.

## One-time BotFather setup

1. Create a bot with [@BotFather](https://t.me/BotFather).
2. Configure its Mini App / menu button URL as `https://ewd-volvo.ru/`.
3. Add the domain `ewd-volvo.ru` to the BotFather allowed domains for the bot.
4. Keep the bot token private. Never add it to git, client code, or a browser
   environment variable.

## VPS configuration

Add the following only to `/opt/ewd-app/.env`:

```dotenv
TELEGRAM_BOT_TOKEN=123456:botfather-token
TELEGRAM_SESSION_SECRET=long-random-secret
# Optional; default is data/telegram.sqlite
TELEGRAM_AUTH_PATH=data/telegram.sqlite
# Optional; default is 86400 seconds
TELEGRAM_INIT_MAX_AGE_SEC=86400
```

Generate a session secret, for example:

```bash
openssl rand -base64 48
```

Run the normal deployment after updating `.env`.

## Security model

- The client sends Telegram `initData` once to `POST /api/telegram/auth`.
- The server verifies Telegram's HMAC signature with the bot token, rejects
  expired payloads, and consumes each accepted `initData` once.
- A short-lived, HttpOnly, same-origin session cookie provides optional profile
  identity. Public wiring-reference endpoints work without it.
- `GET /api/telegram/status` and `/api/health` report only whether Telegram is
  configured; neither exposes a secret.

## Platform checks

Test direct browser plus Telegram Android, iOS, and Desktop:

- Light/dark Telegram themes and orientation changes.
- Diagram pan/zoom, parts illustration popovers, and Telegram BackButton.
- PWA install and Web Push controls are intentionally hidden in Telegram.
- Bluetooth ELM327 support is browser/WebView dependent; do not promise it in
  Telegram until tested on the target client.
