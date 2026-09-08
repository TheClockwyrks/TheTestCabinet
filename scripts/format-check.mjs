// Checks, or rewrites, Prettier formatting over the whole checkout.
//
// A formatting warning anywhere in the repository is a failure: the shared
// packages, the front ends, the documentation, every test case's specs,
// validators, seeded workspaces and reference implementations. Two things are
// left out. What `.prettierignore` names — build trees, vendored copies and the
// Handlebars templates prettier cannot parse — and the frozen test-case versions,
// which a commit hook and CI refuse to modify and so cannot be reformatted. The
// frozen list is derived from the `.frozen` markers on every run, so it never
// goes stale.
//
// Prettier is handed the files git tracks rather than the checkout to expand:
// a reference implementation's installed dependencies and built site are trees
// of tens of thousands of files that no ignore rule keeps prettier from walking.
//
//   node scripts/format-check.mjs           # check; exit 1 on any unformatted file
//   node scripts/format-check.mjs --write   # rewrite every unformatted file

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const prettier = createRequire(import.meta.url).resolve(
  "prettier/bin/prettier.cjs",
);

/** Every `test-cases/<type>/<difficulty>/<slug>/<version>/` carrying `.frozen`. */
function frozenVersions() {
  const dirs = (path) =>
    existsSync(path)
      ? readdirSync(path, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => `${path}/${entry.name}`)
      : [];
  const frozen = [];
  for (const type of dirs("test-cases")) {
    for (const difficulty of dirs(type)) {
      for (const slug of dirs(difficulty)) {
        for (const version of dirs(slug)) {
          if (existsSync(join(repoRoot, version, ".frozen")))
            frozen.push(version);
        }
      }
    }
  }
  return frozen.sort();
}

process.chdir(repoRoot);

const frozen = frozenVersions().map((dir) => `${dir}/`);
const tracked = execFileSync("git", ["ls-files", "-z"], {
  maxBuffer: 256 * 1024 * 1024,
})
  .toString()
  .split("\0")
  .filter((path) => path.length > 0)
  // A frozen version cannot be modified, so it is not formatted either.
  .filter((path) => !frozen.some((dir) => path.startsWith(dir)))
  // A tracked symbolic link is not a file prettier can read.
  .filter((path) => !lstatSync(path).isSymbolicLink());

const write = process.argv.includes("--write");
const BATCH = 1000;
let failed = false;
for (let start = 0; start < tracked.length; start += BATCH) {
  const result = spawnSync(
    process.execPath,
    [
      prettier,
      write ? "--write" : "--check",
      "--ignore-unknown",
      "--log-level",
      "warn",
      "--ignore-path",
      ".gitignore",
      "--ignore-path",
      ".prettierignore",
      ...tracked.slice(start, start + BATCH),
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) failed = true;
}

if (failed) {
  console.error(
    write
      ? "some files could not be formatted"
      : "formatting differs from prettier's; run `npm run format`",
  );
  process.exit(1);
}
console.log(`${tracked.length} tracked files considered; formatting is clean`);
