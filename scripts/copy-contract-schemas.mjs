// Copy the data contract's JSON Schemas into the documentation site.
//
// The contracts repository (the `contracts/` submodule) generates and commits the
// `core/` and `gg/` schemas under its `schema/`. The docs site publishes them at
// `https://docs.testcabinet.ai/schema/{core,gg}/`, the URLs their `$id`s name, so
// its `prebuild` and `predev` copy them into `apps/docs/public/schema/{core,gg}/`,
// which `.gitignore` lists. The other directories under `apps/docs/public/schema/`
// are api-codegen's and are committed in place.
//
// A docs build without the submodule would publish a site with no data-contract
// schemas, so a missing checkout fails here, loudly, instead of skipping.
//
// Usage: `node scripts/copy-contract-schemas.mjs` (from any directory).

import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "contracts", "schema");
const target = join(root, "apps", "docs", "public", "schema");
const DIRECTORIES = ["core", "gg"];

for (const dir of DIRECTORIES) {
  if (!existsSync(join(source, dir))) {
    console.error(
      `copy-contract-schemas: ${relative(root, join(source, dir))} does not exist.\n` +
        "The data contract's schemas come from the contracts submodule. Check it out with\n" +
        "    git submodule update --init contracts",
    );
    process.exit(1);
  }
}

for (const dir of DIRECTORIES) {
  rmSync(join(target, dir), { recursive: true, force: true });
  cpSync(join(source, dir), join(target, dir), { recursive: true });
}
console.log(
  `copy-contract-schemas: copied ${DIRECTORIES.map((d) => `schema/${d}/`).join(" and ")} from contracts/`,
);
