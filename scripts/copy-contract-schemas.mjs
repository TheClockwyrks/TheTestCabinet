// Copy the contract JSON Schemas into the documentation site.
//
// The contracts repository (the `contracts/` submodule) generates and commits
// every schema under its `schema/`: the data contract's (`core/`, `gg/`) and the
// backend API's (`backend-api/`, `coverage/`, `jobs-api/`, `snapshot/`). The docs
// site publishes them at `https://docs.testcabinet.ai/schema/<dir>/`, the URLs
// their `$id`s name, so its `prebuild` and `predev` copy them into
// `apps/docs/public/schema/`, which `.gitignore` lists.
//
// A docs build without the submodule would publish a site with no contract
// schemas, so a missing checkout fails here, loudly, instead of skipping.
//
// Usage: `node scripts/copy-contract-schemas.mjs` (from any directory).

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "contracts", "schema");
const target = join(root, "apps", "docs", "public", "schema");
const DIRECTORIES = [
  "core",
  "gg",
  "backend-api",
  "coverage",
  "jobs-api",
  "snapshot",
];

for (const dir of DIRECTORIES) {
  if (!existsSync(join(source, dir))) {
    console.error(
      `copy-contract-schemas: ${relative(root, join(source, dir))} does not exist.\n` +
        "The contract schemas come from the contracts submodule. Check it out with\n" +
        "    git submodule update --init contracts",
    );
    process.exit(1);
  }
}

// One file at a time rather than `cpSync`: Node's native directory copy fails
// with EACCES on a virtiofs mount, which is what a devcontainer on a macOS
// host works in, and the schemas are a few dozen small files.
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const next = [join(from, entry.name), join(to, entry.name)];
    if (entry.isDirectory()) copyTree(...next);
    else copyFileSync(...next);
  }
}

for (const dir of DIRECTORIES) {
  rmSync(join(target, dir), { recursive: true, force: true });
  copyTree(join(source, dir), join(target, dir));
}
console.log(
  `copy-contract-schemas: copied ${DIRECTORIES.map((d) => `schema/${d}/`).join(", ")} from contracts/`,
);
