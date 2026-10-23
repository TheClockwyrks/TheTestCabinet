// Checks, or rewrites, Prettier formatting over the whole checkout.
//
// A formatting warning anywhere in the repository is a failure: the shared
// packages, the front ends and the documentation. What `.prettierignore` names —
// build trees, vendored copies, the Handlebars templates prettier cannot parse
// and the submodules, whose own gates format them — is left out.
//
// `.prettierignore` is rendered from the project template, whose broad rules
// also cover a few tracked sources this project has always formatted: the
// Kubernetes manifests under `deployments/k8s/`. Those are checked in a pass of
// their own that honours `.gitignore` alone (see `REINCLUDED`).
//
// Prettier is handed the files git tracks rather than the checkout to expand:
// an installed dependency tree or a built site is tens of thousands of files that
// no ignore rule keeps prettier from walking.
//
// Three things keep the pass quick over a checkout of ~74k tracked files:
//
//   - Only the files prettier has a parser for are handed to it. Better than
//     half of what git tracks is PNG, webm, glb or gzip, and prettier spends
//     milliseconds per file working out it can do nothing with each one. The
//     extensions come from prettier's own support table, so the filter cannot
//     disagree with the parser it is predicting.
//   - The remaining files are split into batches run across every core, since
//     one prettier process formats on one thread.
//   - Each shard keeps a cache of what it has already seen formatted, keyed on
//     file contents, so a re-run only pays for what changed. A shard is picked
//     by hashing the path, so a file lands in the same shard — and so hits the
//     same cache — on every run.
//
//   node scripts/format-check.mjs           # check; exit 1 on any unformatted file
//   node scripts/format-check.mjs --write   # rewrite every unformatted file
//   node scripts/format-check.mjs --no-cache

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSupportInfo } from "prettier";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const prettier = createRequire(import.meta.url).resolve(
  "prettier/bin/prettier.cjs",
);

/**
 * A test for the paths prettier has a parser for, built from prettier's own
 * support table. Extensions are matched as suffixes rather than by splitting on
 * the last dot, because several of them carry one of their own: `.json.example`
 * and `.component.html` are each a single entry in that table.
 */
async function formattable() {
  const extensions = [];
  const filenames = new Set();
  for (const language of (await getSupportInfo()).languages) {
    for (const extension of language.extensions ?? [])
      extensions.push(extension.toLowerCase());
    for (const filename of language.filenames ?? [])
      filenames.add(filename.toLowerCase());
  }
  return (path) => {
    const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
    return (
      filenames.has(name) ||
      extensions.some((extension) => name.endsWith(extension))
    );
  };
}

process.chdir(repoRoot);

const write = process.argv.includes("--write");
const cache = !process.argv.includes("--no-cache");

const known = await formattable();
// `--stage` prints each entry as `<mode> <object> <stage>\t<path>`, which is what
// tells a submodule apart: its entry is a gitlink (mode 160000), a directory that
// is empty in a checkout that never initialized it, where prettier fails for want
// of files, and the whole media tree of `cold-storage/` in one that did.
const tracked = execFileSync("git", ["ls-files", "--stage", "-z"], {
  maxBuffer: 256 * 1024 * 1024,
})
  .toString()
  .split("\0")
  .filter((entry) => entry.length > 0)
  .filter((entry) => !entry.startsWith("160000 "))
  .map((entry) => entry.slice(entry.indexOf("\t") + 1))
  // A tracked symbolic link is not a file prettier can read, and a tracked file
  // deleted from the working tree (a removal not yet committed) is not there to
  // read at all.
  .filter((path) => {
    const stats = lstatSync(path, { throwIfNoEntry: false });
    return stats !== undefined && !stats.isSymbolicLink();
  });
const targets = tracked.filter(known);

// Tracked sources the template's `.prettierignore` leaves out that this project
// formats anyway: the Kubernetes manifests (its `deployments/k8s/` rule). They
// are checked without that ignore file.
const REINCLUDED = [
  (path) => path.startsWith("deployments/k8s/") && /\.(ya?ml|json)$/.test(path),
];
const reincluded = (path) => REINCLUDED.some((test) => test(path));

// One shard per core, each its own prettier process and its own cache file. The
// shard is chosen by hashing the path so that it is stable from run to run: a
// file that moved between shards would miss the cache every time.
const shardCount = Math.max(1, Math.min(availableParallelism(), 16));
// Each shard holds two lists: the paths checked against `.prettierignore` too,
// and the `REINCLUDED` ones, checked against `.gitignore` alone.
const shards = Array.from({ length: shardCount }, () => ({
  standard: [],
  reincluded: [],
}));
for (const path of targets) {
  const digest = createHash("sha1").update(path).digest();
  const shard = shards[digest.readUInt32BE(0) % shardCount];
  (reincluded(path) ? shard.reincluded : shard.standard).push(path);
}
const IGNORE_PATHS = {
  standard: ["--ignore-path", ".gitignore", "--ignore-path", ".prettierignore"],
  reincluded: ["--ignore-path", ".gitignore"],
};

const cacheDir = join(repoRoot, "node_modules", ".cache", "format-check");
if (cache) mkdirSync(cacheDir, { recursive: true });

// An argument list has a length ceiling, so a shard is spent a batch at a time.
// The batches of one shard run in sequence, which is also what lets them share
// the one cache file without racing each other over it.
const BATCH_BYTES = 96 * 1024;
function batches(paths) {
  const out = [];
  let current = [];
  let bytes = 0;
  for (const path of paths) {
    if (current.length > 0 && bytes + path.length + 1 > BATCH_BYTES) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(path);
    bytes += path.length + 1;
  }
  if (current.length > 0) out.push(current);
  return out;
}

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [prettier, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("close", (status) => resolve({ status, out, err }));
  });
}

async function runShard(index) {
  const unformatted = [];
  const errors = [];
  let failed = false;
  const work = Object.entries(IGNORE_PATHS).flatMap(([kind, ignorePaths]) =>
    batches(shards[index][kind]).map((batch) => ({ batch, ignorePaths })),
  );
  for (const { batch, ignorePaths } of work) {
    const { status, out, err } = await run([
      write ? "--write" : "--check",
      "--log-level",
      "warn",
      ...ignorePaths,
      ...(cache
        ? [
            "--cache",
            "--cache-strategy",
            "content",
            "--cache-location",
            join(cacheDir, `shard-${index}`),
          ]
        : []),
      ...batch,
    ]);
    // Prettier names each offending file on its own `[warn]` line and then signs
    // off with a summary line naming none. Only the former is worth keeping: the
    // summary would otherwise repeat once per batch per shard. A file prettier
    // cannot parse is reported instead as a run of `[error]` lines — a message
    // and the code frame under it — which are held in the order they arrived,
    // since sorting them would shuffle each frame away from its message.
    for (const line of (out + err).split("\n")) {
      const path = line.match(/^\[warn] (\S+)$/)?.[1];
      if (path) unformatted.push(path);
      else if (line.startsWith("[error]")) errors.push(line);
    }
    if (status !== 0) failed = true;
  }
  return { unformatted, errors, failed };
}

const results = await Promise.all(shards.map((_, index) => runShard(index)));
// Shards finish in whatever order they finish in, so the files they name are
// sorted back into one order that does not depend on how the work was split.
const unformatted = results.flatMap((result) => result.unformatted).sort();
const errors = results.flatMap((result) => result.errors);
const failed = results.some((result) => result.failed);

for (const line of errors) console.error(line);
for (const path of unformatted) console.error(path);

if (failed) {
  if (unformatted.length > 0)
    console.error(
      write
        ? `${unformatted.length} file(s) could not be formatted`
        : `${unformatted.length} file(s) differ from prettier's formatting; run \`npm run format\``,
    );
  if (errors.length > 0) console.error("prettier could not parse every file");
  process.exit(1);
}
console.log(
  `${targets.length} of ${tracked.length} tracked files are prettier's to format; formatting is clean`,
);
