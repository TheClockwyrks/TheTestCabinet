#!/usr/bin/env node
// Verifies every version's `[audio] packs` declaration against the pack registry.
//
// Manifest resolution checks the shape of a declaration — pinned `name@version`
// refs, no pack named twice, the arity the `asset_kind` allows — but it also runs at
// backend ingest, where `containers/sample-packs/` is absent, so it cannot check a
// ref against the registry. This is where that happens, and it is the only
// enforcement of the rule that every non-frozen full-stack version and every game
// jam declares the key at all. It runs on the commit hook and in CI, exactly as
// `frozen-check.sh` backstops the `frozen-paths.sh` hook.
//
//   node scripts/ci/audio-packs-check.mjs
//
// Exits non-zero, listing every fault, when any version fails. On success it prints
// the defaults each full-stack and game-jam version's pack order resolves to, so a
// reordering — which silently changes what an unqualified `sfx-sample` or `music`
// call plays — is visible in a CI log as well as in the manifest diff.

import { checkRepository, repositoryRoot } from "../lib/audio-packs.mjs";

const root = process.argv[2] ?? repositoryRoot();
const { errors, versions } = checkRepository({ root });

for (const version of versions) {
  if (version.testType !== "full-stack" && version.testType !== "game-jam")
    continue;
  const defaults = Object.entries(version.defaults)
    .map(
      ([kind, ref]) =>
        `${kind === "sample-pack" ? "sfx-sample" : "music"} → ${ref}`,
    )
    .join(", ");
  const declared =
    version.packs === null
      ? "the frozen default"
      : version.packs.length === 0
        ? "no packs"
        : version.packs.join(", ");
  console.log(`${version.id}: ${declared}${defaults ? ` (${defaults})` : ""}`);
}

if (errors.length > 0) {
  console.error(`\n${errors.length} audio pack declaration problem(s):\n`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log(
  `\nEvery declared audio pack resolves (${versions.length} versions checked).`,
);
