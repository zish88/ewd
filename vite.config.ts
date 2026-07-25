import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "client",
  plugins: [tailwindcss()],
  server: {
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
