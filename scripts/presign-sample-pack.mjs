// Resolve a published sample pack to a short-lived, credential-free download URL.
//
// `containers/build.sh` calls this at image-build time for the `sfx-sample` /
// `music` images: given a pinned pack ref (`<name>@<version>`), it reads the pin in
// `containers/sample-packs/packs.lock.json` (written by `build-sample-pack.mjs
// --publish`), mints a presigned R2 GET URL for the pack's object, and prints TWO
// lines to stdout:
//
//   <presigned-url>
//   sha256:<digest>
//
// which the caller feeds to the image build as `*_URL` + `*_SHA256`. Reads only the
// read-scoped PRESIGN credentials (see `scripts/lib/r2.mjs`). Exits non-zero with a
// message on stderr when the pack is not pinned, so the caller can distinguish
// "not published yet" (skip the image) from "presign failed" (a real error).
//
// Usage:
//   node scripts/presign-sample-pack.mjs <name@version> [--expires <seconds>]

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadDotEnv } from "./lib/env.mjs";
import { presignGetUrl, r2ConfigFromEnv } from "./lib/r2.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const LOCK_PATH = join(
  repoRoot,
  "containers",
  "sample-packs",
  "packs.lock.json",
);

function fail(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}

/** Read the pin file, returning `{}` when it is absent or empty. */
export function readLock(path = LOCK_PATH) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  const trimmed = raw.trim();
  if (trimmed === "") return {};
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    fail(`parsing ${path}: ${err.message}`);
  }
}

function main() {
  loadDotEnv();

  const argv = process.argv.slice(2);
  let ref = null;
  let expiresIn = 3600;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--expires") {
      expiresIn = Number(argv[++i]);
      if (
        !Number.isInteger(expiresIn) ||
        expiresIn <= 0 ||
        expiresIn > 604800
      ) {
        fail("--expires must be an integer in 1..604800 seconds");
      }
    } else if (a.startsWith("-")) {
      fail(`unknown flag ${a}`);
    } else if (ref === null) {
      ref = a;
    } else {
      fail(`unexpected extra argument ${a}`);
    }
  }
  if (!ref) fail("name a pack ref, e.g. `combat-core@0.1.0`");

  const lock = readLock();
  const pin = lock[ref];
  if (!pin) {
    fail(
      `pack ${ref} is not published (no entry in ${LOCK_PATH}). ` +
        `Run: node scripts/build-sample-pack.mjs <pack> --publish`,
    );
  }
  if (!pin.key || !pin.sha256) {
    fail(`pin for ${ref} is malformed (needs "key" and "sha256")`);
  }

  const cfg = r2ConfigFromEnv("presign");
  // A pin may record the bucket it was published to; honor it if present so a pack
  // published to a non-default bucket still resolves against the right one.
  const bucket = pin.bucket ?? cfg.bucket;
  const url = presignGetUrl({ ...cfg, bucket, key: pin.key, expiresIn });

  process.stdout.write(`${url}\n${pin.sha256}\n`);
}

// Only run when invoked directly (`node scripts/presign-sample-pack.mjs …`), not
// when `build-sample-pack.mjs` imports `readLock` / `LOCK_PATH` from here.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
