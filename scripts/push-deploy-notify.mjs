/**
 * Send Web Push for a new deploy while the app container may be down
 * (nginx still serves updating.html). Uses the same rules as server startup.
 *
 * Usage (VPS, after stamp + docker build, before docker run):
 *   npx tsx scripts/push-deploy-notify.mjs
 *
 * Env: VAPID_*, DATABASE_PATH / PUSH_* paths, CLIENT_DIST (notes location).
 */
import { ensurePushStore, maybeNotifyDeployUpdate } from "../server/pushNotify.ts";

ensurePushStore();
await maybeNotifyDeployUpdate();
