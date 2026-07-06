// Minimal `.env` loader for the repo's Node scripts.
//
// The sample-pack publish/presign scripts read their R2 credentials from the
// environment. Locally those live in the repo-root `.env` (gitignored); in CI they
// are set directly on the job from GitHub secrets/vars. `loadDotEnv` bridges the
// two: it populates `process.env` from `.env` for any key NOT already set, so a
// real environment variable (CI) always wins over the file (local), and a missing
// `.env` is a silent no-op (the CI case). No dependency — a tiny KEY=VALUE parser.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Load repo-root `.env` into `process.env`, without overriding already-set keys.
 * Returns the number of keys applied (0 when the file is absent). `path` overrides
 * the file location (defaults to `<repo>/.env`).
 */
export function loadDotEnv(path = join(repoRoot, ".env")) {
  if (!existsSync(path)) return 0;
  let applied = 0;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key === "" || key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    // Strip a single layer of matching surrounding quotes.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
    applied++;
  }
  return applied;
}
