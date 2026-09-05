#!/usr/bin/env bash
# Gate: the generated contract package that gets SEEDED must not name this project
# or say anything about how a run is judged.
#
# `@clockwyrks/asset-contract` describes the rig a produced model is made of, and
# `packages/voxel-runtime` / `packages/particle-runtime` depend on it. Those
# runtimes are vendored into a model's own workspace at seed time, so every byte of
# this package travels with them and is readable by the model building the case.
#
# That makes it the one generated package bound by
# `guides/authoring/writing-case-specifications.md`: a model must not learn that it
# is being evaluated, that its output is scored, or that The Test Cabinet exists.
# The package is generated from Rust doc comments by `crates/contract-codegen`,
# which copies them through verbatim (`ts_rs` `T::docs()`), so a `///` line added to
# one of these types on the Rust side lands in a run workspace — silently, because
# nothing else looks. This is what looks.
#
# The rest of the contract (`@clockwyrks/run-record` — records, reviews, ladders,
# snapshots) is deliberately NOT checked: it is never seeded, and it is supposed to
# talk about evaluation.
#
# To fix a failure, reword the Rust doc comment so it describes the shape rather
# than the machinery around it, and move any maintainer-facing note to a plain `//`
# comment beneath it, which is not copied. `crates/core/src/test_case.rs`'s
# `ModelSpec` is the worked example.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

readonly PKG="packages/asset-contract/src"

# Two tiers, because the two bodies of code can afford different vocabulary.
#
# STRICT applies to the generated asset contract, which is nothing but wire shapes.
# No word here has an innocent reading in a file that describes a rig, so the list
# can be broad — and being broad is the point, since its prose comes from Rust doc
# comments written by someone thinking about the harness.
readonly STRICT='test.cabinet|testcabinet|\btcab\b|\bbenchmark(s|ed|ing)?\b|\bevaluat(e|ed|es|ing|ion)\b|\bscor(e|ed|es|ing)\b|\bgrad(e|ed|es|ing)\b|\breview(s|ed|er|ers|ing)?\b|\brun.record\b|\bleaderboard\b|\bladder\b|\bharness\b|https?://'

# HANDWRITTEN applies to the engines and runtimes, which are ordinary game code and
# legitimately full of words STRICT bans: `player.score` is a game's own score, an
# F-curve is `evaluated`, and the spec guide explicitly permits naming reviewers
# ("Mentioning reviewers is acceptable"). So this tier bans only what has no reading
# except this project: our identity, our nouns for the machinery around a run, and
# the surfaces a model has no business knowing exist.
readonly HANDWRITTEN='test.cabinet|testcabinet|\btcab\b|\brun.record\b|\bleaderboard\b|\bbenchmark(s|ed|ing)?\b|review (tab|page|queue|ui)|\bthe review UI\b|\bthis (test.)?case.s manifest\b'

if [ ! -d "$PKG" ]; then
	echo >&2 "seeded-contract-check: $PKG does not exist."
	echo >&2 "If the package moved, update this gate — do not delete it."
	exit 1
fi

# A relocated or emptied package would otherwise sail through the greps below, and
# the gate would report success having checked nothing.
if [ -z "$(find "$PKG" -name '*.ts' -print -quit)" ]; then
	echo >&2 "seeded-contract-check: $PKG holds no TypeScript."
	echo >&2 "The generator writes it (crates/contract-codegen). Run \`npm run gen:contract\`."
	exit 1
fi

# Tested on the OUTPUT rather than grep's exit status: this repo's `grep` is ugrep,
# whose status for a recursive search is not reliably 1-on-no-match, and a gate that
# misreads "nothing found" as "found something" is a gate nobody will keep.
hits=$(grep -rniE "$STRICT" "$PKG" 2>/dev/null || true)
if [ -n "$hits" ]; then
	echo >&2 "The seeded contract package names what a model must not learn:"
	echo >&2
	echo "$hits" >&2
	echo >&2
	echo >&2 "These types are vendored into a model's workspace. Reword the Rust doc"
	echo >&2 "comment they are generated from (crates/core, crates/backend) and rerun"
	echo >&2 "\`npm run gen:contract\`. See the header of this script."
	exit 1
fi

# The engines and runtimes themselves. These are hand-written, they ship their doc
# comments in the `.d.ts` and `.js` they publish, and they are vendored into the run
# workspace under `.vendor/engine/` and `.vendor/packages/` — so their prose is read
# by the model exactly as the generated package's is. Checking only the generated
# half was the gap that let "the run record would describe a run that never happened"
# sit in three engines' published output.
seeded_dirs=$(node --input-type=module -e '
import { readFileSync } from "node:fs";
const src = readFileSync("scripts/stage-tcab-packages.mjs", "utf8");
const list = src.match(/const SHIPPABLE = \[(.*?)\]/s)?.[1] ?? "";
const names = [...list.matchAll(/"@clockwyrks\/([a-z0-9-]+)"/g)].map((m) => m[1]);
if (!names.length) { console.error("could not read SHIPPABLE"); process.exit(1); }
// case-harness is read after the container is gone, never seeded into the workspace.
console.log(names.filter((n) => n !== "case-harness").join(" "));
') || exit 1

for dir in $seeded_dirs; do
	for sub in src docs; do
		[ -d "packages/$dir/$sub" ] || continue
		# Only what the package actually publishes. Every engine's tsconfig excludes
		# `src/**/*.test.ts` and `src/testing` from the build, so neither reaches a
		# `dist/` and neither reaches a run — `src/testing/gl.ts`'s WebGL stub reports
		# a VENDOR string naming this project and is genuinely fine where it is.
		hits=$(grep -rniE "$HANDWRITTEN" "packages/$dir/$sub" 2>/dev/null |
			grep -vE "^packages/$dir/$sub/testing/|\.test\.tsx?:" || true)
		if [ -n "$hits" ]; then
			echo >&2 "A seeded package names what a model must not learn:"
			echo >&2
			echo "$hits" >&2
			echo >&2
			echo >&2 "This package is vendored into a model's workspace, doc comments and all."
			echo >&2 "Reword so it describes the game or the engine rather than the machinery"
			echo >&2 "around a run. Naming a *reviewer* is fine; naming our surfaces is not."
			exit 1
		fi
	done
done

# The other half of the same guarantee, and the one that actually regressed once:
# scrubbing this package's words is pointless if a seedable package reaches the
# evaluation contract by an edge instead. Seeding copies a package's whole `file:`
# closure out of the host store, so one `dependencies` entry is all it takes for
# `run-record` — records, reviews, ladders, snapshots — to land in a run workspace
# again. The seeding tests cannot catch this: they build synthetic store fixtures
# and exercise the closure mechanism, not the real manifests.
#
# The script below is node, not shell: nothing in it is meant to expand here, and
# the word splitting on the last line is how the derived list becomes argv.
# shellcheck disable=SC2016,SC2086
node --input-type=module -e '
import { readFileSync } from "node:fs";

// Read from the caller rather than hand-copied, so this cannot drift from the
// SHIPPABLE list the staging script actually stages.
const SEEDED = process.argv.slice(2);
const BANNED = "@clockwyrks/run-record";

const manifest = (dir) =>
  JSON.parse(readFileSync(`packages/${dir}/package.json`, "utf8"));
const dirOf = (name) => name.replace(/^@clockwyrks\//, "");

const failures = [];
for (const root of SEEDED) {
  const seen = new Set();
  const walk = (dir, path) => {
    if (seen.has(dir)) return;
    seen.add(dir);
    for (const dep of Object.keys(manifest(dir).dependencies ?? {})) {
      if (!dep.startsWith("@clockwyrks/")) continue;
      const trail = [...path, dep];
      if (dep === BANNED) { failures.push(trail.join(" -> ")); continue; }
      walk(dirOf(dep), trail);
    }
  };
  walk(root, [`@clockwyrks/${root}`]);
}

if (failures.length) {
  console.error("A seeded package depends on the evaluation contract:\n");
  for (const f of failures) console.error("  " + f);
  console.error(`\nSeeding copies the whole \`file:\` closure into the run repository, so
${BANNED} would be readable by the model — leaderboards, reviews and
all. Depend on @clockwyrks/asset-contract instead, or move the type you need
into it (crates/contract-codegen, ASSET_SPEC_TYPES).`);
  process.exit(1);
}
' -- $seeded_dirs

echo "Seeded packages ($seeded_dirs) name nothing about evaluation and none reaches the contract."
