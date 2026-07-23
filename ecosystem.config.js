/**
 * PM2 process file for VPS deploy without Docker.
 * Usage: npm run build && pm2 start ecosystem.config.js
 */
export default {
  apps: [
    {
      name: "volvo-xc70-wiring",
      script: "npx",
      args: "tsx server/index.ts",
      interpreter: "none",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        DATABASE_PATH: "data/wiring.sqlite",
        EWD_DATA_DIR: "data/ewd",
        CLIENT_DIST: "client/dist",
      },
    },
  ],
};
