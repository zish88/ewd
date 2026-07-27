import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: "client",
  plugins: [tailwindcss()],
  // humanize тянет server/optionExpression + data/ewd/*.json из корня репо
  server: {
    fs: { allow: [repoRoot] },
    proxy: {
      "/api": "http://localhost:3000",
      // Local HTTP only — avoids mixed-content when UI is https://ewd-volvo.ru
      "/obd-gw": {
        target: "http://192.168.4.1",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/obd-gw/, ""),
      },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
