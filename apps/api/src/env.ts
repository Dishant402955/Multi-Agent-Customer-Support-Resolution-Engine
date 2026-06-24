// Loads root .env (walks up the tree) and exposes typed config.
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

(() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return config({ path: candidate });
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  config();
})();

export const ENV = {
  API_PORT: Number(process.env.API_PORT || 4100),
  AGENT_URL: process.env.AGENT_URL || "http://localhost:5000",
  DB_PATH: process.env.API_DB_PATH || "support.db",
};
