#!/usr/bin/env node
// Gate: the SEEDED spec text — the files a model actually receives — must not name
// this project or say anything about how a run is judged.
//
// `guides/authoring/writing-case-specifications.md` § "Keeping evaluation out of
// the seeded set" states the rule: a model must not learn that it is being
// evaluated, that its output is scored, or that The Test Cabinet exists. Knowing it
// is under test changes how a model behaves and contaminates the result.
// `seeded-contract-check.sh` enforces that rule for the seeded PACKAGES (the
// generated contract, the engines, the runtimes). Nothing enforced it for the specs
// themselves, and a spec is the one thing a model is guaranteed to read — so
// "canonical benchmark opponent" sat in a shipped spec, and "the review UI" in
// fourteen prompts, until this looked.
//
//   node scripts/ci/spec-vocabulary-check.mjs [--show-frozen]
//
// WHAT IS SEEDED (and therefore checked). `crates/core/src/seeding.rs` copies, for
// every run, the version's `prompt.hbs` (rendered into the harness instruction by
// `crates/core/src/prompt.rs`) and the spec files the manifest names — every one of
// which lives under `specs/`: `.md` and `.py` verbatim, `.md.hbs` rendered. So under
// every `test-cases/**/vX.Y.Z/` and `game-jams/**/vX.Y.Z/` this reads `prompt.hbs`
// and every file under `specs/`. It deliberately reads ALL of `specs/` rather than
// the manifest's list, because a file nobody seeds today is a file somebody seeds
// tomorrow with one `[[spec]]` line, and the superset is cheap. It does NOT read
// `description.md`, `changelog.md`, the version's `README.md`, `references/`,
// `workspaces/` or `validation/`: none of those is seeded (the workspace has its own
// rule and its own guide page), and the README in particular is maintainer prose
// that openly says "test case".
//
// `prompt.rs` also PREPENDS shared wording to every asset-generation, full-stack and
// game-jam prompt from `const NAME: &str = "..."` literals. Those travel exactly as
// a `prompt.hbs` does, so this also reads every such single-line literal out of
// `prompt.rs` and holds it to the same list. Two seeded strings are out of reach:
// the `reference/README.md` notice and the prior-jam-entries index in `seeding.rs`
// are multi-line `format!` bodies this does not parse. Both are short, both were
// read when this gate was written, and both are clean; a change to either is a
// change to reread.
//
// FROZEN VERSIONS are skipped for pass/fail but never silently. A `.frozen` marker
// means runs are recorded against that version; `frozen-check.sh` and the commit
// hook refuse any edit to it, so a hit there is one nobody can fix, and a gate that
// can never go green is a gate nobody keeps. The hits are still counted and
// summarized on one line (`--show-frozen` lists them) so the leak stays visible: it
// is a reason to cut a new version, not a reason to relax the list.
//
// THE LIST. Specs are game prose, and a game legitimately says most of what a
// harness says: `score` is the player's score (171 spec files), an F-curve is
// `evaluated`, Foray's match `harness` and Lattice's `validator` are those cases'
// own product vocabulary, `leaderboard` is an in-game board, `graded` is a road,
// `@clockwyrks` is the npm scope of the engines a model is handed by design, and
// the guide explicitly permits naming *reviewers*. So, as the HANDWRITTEN tier of
// `seeded-contract-check.sh` does, this bans only what has no reading except this
// project — our identity, our nouns for the machinery around a run, and the
// surfaces a model has no business knowing exist — plus the two words on the
// guide's own list that the sweep showed are never used innocently in a spec
// ("benchmark", "evaluation"). "grading" and "scoring", also on that list, are NOT
// banned: Junction's roads are graded and every game scores.
//
// One deliberate exemption: `tcab-blend` is the Blender runner on the model's PATH
// in the siege-* asset cases, named in their prompts, briefs and `build.py`. It is
// a product binary the model must invoke, so it stays; bare `tcab` — the CLI, and
// the name of everything else we ship — does not. The lookahead in the rule is what
// separates them. Never rename `tcab-blend` to satisfy this gate.
//
// TO FIX A FAILURE, reword the sentence so it describes the game or the asset
// rather than the machinery around a run: "canonical baseline opponent" for
// "canonical benchmark opponent"; "the game, or any viewer that plays it, simulates
// it live" for "the review UI simulates it live". A `.md.hbs` spec is edited by hand
// and never run through prettier (it destroys them). If the hit is in a frozen
// version it is not yours to fix here — the fix is a new version.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHOW_FROZEN = process.argv.includes("--show-frozen");

const TREES = ["test-cases", "game-jams"];
const VERSION_DIR = /^v\d+\.\d+\.\d+$/;
const FROZEN_MARKER = ".frozen";
const PROMPT_RS = "crates/core/src/prompt.rs";
// Spec directories hold prose and source today (.md, .md.hbs, .py). Anything else
// is read as text too — a stray .txt is seeded just the same — except obvious
// binary media, which cannot carry a sentence.
const BINARY = /\.(png|jpe?g|gif|webp|wav|mp3|ogg|glb|gltf|bin|zip|woff2?)$/i;

// Every rule is case-insensitive. `why` is what the failure output says.
const RULES = [
  {
    name: "identity",
    re: /test[\s_.-]?cabinet/i,
    why: "names this project (test cabinet / test-cabinet / testcabinet / the-test-cabinet)",
  },
  {
    name: "tcab",
    // `tcab-blend` is the Blender runner the siege-* cases must invoke; see header.
    re: /\btcab\b(?!-blend\b)/i,
    why: "names the CLI or a tcab-* component (only `tcab-blend`, a product binary, is exempt)",
  },
  {
    name: "benchmark",
    re: /\bbenchmark(s|ed|ing)?\b/i,
    why: "frames the work as a benchmark",
  },
  {
    name: "test case",
    re: /\btest[\s-]cases?\b/i,
    why: "calls the game a test case",
  },
  {
    name: "evaluation",
    re: /\bevaluations?\b/i,
    why: "names the evaluation (the verb `evaluate` is game vocabulary and is allowed)",
  },
  {
    name: "run record",
    // Singular only, as in seeded-contract-check.sh: "a cleared run records its
    // score" is a verb a game spec uses; "the run record" is our contract.
    re: /\brun[\s-]record\b/i,
    why: "names the run record contract",
  },
  {
    name: "review surface",
    re: /\breview[\s-](tab|page|queue|ui)\b/i,
    why: "names a review surface of ours (reviewers may be mentioned; our UI may not)",
  },
  {
    name: "case manifest",
    re: /\bthis (test[\s-])?case'?s manifest\b/i,
    why: "points at the case manifest, which a model never sees",
  },
  {
    name: "repository or gallery URL",
    re: /\b(testcabinet\.ai|github\.com\/theclockwyrks)\b/i,
    why: "links to this repository or the gallery",
  },
];

/** Version folders under a tree, without descending into a version once found. */
function versionDirs(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (VERSION_DIR.test(entry.name)) out.push(path);
    else versionDirs(path, out);
  }
  return out;
}

/** Every regular file under `dir`, recursively. */
function filesUnder(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(path, out);
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/** `{ line, text, rules }` for every line of `text` at least one rule matches. */
function scan(text) {
  const hits = [];
  text.split("\n").forEach((line, index) => {
    const rules = RULES.filter((rule) => rule.re.test(line));
    if (rules.length > 0)
      hits.push({ line: index + 1, text: line.trim(), rules });
  });
  return hits;
}

const rel = (path) => relative(ROOT, path).split(sep).join("/");

function fail(message) {
  console.error(`spec-vocabulary-check: ${message}`);
  process.exit(1);
}

// ---- collect ------------------------------------------------------------------

for (const tree of TREES) {
  if (!existsSync(join(ROOT, tree))) {
    fail(
      `${tree}/ does not exist. If the tree moved, update this gate — do not delete it.`,
    );
  }
}

const versions = TREES.flatMap((tree) =>
  versionDirs(join(ROOT, tree), []),
).sort();
// A renamed tree or a changed version-folder convention would otherwise leave the
// loops below with nothing to read, and the gate would pass having checked nothing.
if (versions.length === 0) {
  fail("found no vX.Y.Z version folders under test-cases/ or game-jams/.");
}

let specFiles = 0;
let promptFiles = 0;
let frozenVersions = 0;
const failures = []; // non-frozen: { path, ...hit }
const frozen = new Map(); // version -> hit count

for (const version of versions) {
  const isFrozen = existsSync(join(version, FROZEN_MARKER));
  if (isFrozen) frozenVersions += 1;

  const files = [];
  const prompt = join(version, "prompt.hbs");
  if (existsSync(prompt)) {
    files.push(prompt);
    promptFiles += 1;
  }
  const specs = join(version, "specs");
  if (existsSync(specs) && statSync(specs).isDirectory()) {
    const found = filesUnder(specs, []).filter((f) => !BINARY.test(f));
    specFiles += found.length;
    files.push(...found);
  }

  for (const file of files) {
    const hits = scan(readFileSync(file, "utf8"));
    if (hits.length === 0) continue;
    if (isFrozen) {
      frozen.set(version, (frozen.get(version) ?? 0) + hits.length);
      if (SHOW_FROZEN) {
        for (const hit of hits)
          console.log(`frozen ${rel(file)}:${hit.line}: ${hit.text}`);
      }
    } else {
      for (const hit of hits) failures.push({ path: rel(file), ...hit });
    }
  }
}

if (specFiles === 0)
  fail("found no files under any version's specs/. The gate checked nothing.");
if (promptFiles === 0)
  fail("found no prompt.hbs in any version. The gate checked nothing.");

// The shared prompt wording prompt.rs prepends. Single-line `const NAME: &str = "..."`
// literals only; that is how every preamble there is written today, and the guard
// below notices if that stops being true.
const promptSource = readFileSync(join(ROOT, PROMPT_RS), "utf8");
const CONST_LITERAL =
  /^\s*(?:pub(?:\([a-z]+\))?\s+)?const\s+([A-Z0-9_]+)\s*:\s*&(?:'static\s+)?str\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/;
let constants = 0;
promptSource.split("\n").forEach((line, index) => {
  const m = CONST_LITERAL.exec(line);
  if (!m) return;
  constants += 1;
  const literal = m[2].replace(/\\n/g, " ");
  const rules = RULES.filter((rule) => rule.re.test(literal));
  if (rules.length > 0) {
    const matched = rules.map((rule) => literal.match(rule.re)[0]).join("…");
    failures.push({
      path: PROMPT_RS,
      line: index + 1,
      text: `const ${m[1]}: "…${matched}…"`,
      rules,
    });
  }
});
if (constants === 0) {
  fail(
    `read no \`const NAME: &str = "..."\` literals from ${PROMPT_RS}. ` +
      "The shared prompt preambles live there; if they moved or changed shape, update this gate.",
  );
}

// ---- report -------------------------------------------------------------------

const checked = `${specFiles} spec files and ${promptFiles} prompts across ${versions.length} versions, plus ${constants} shared prompt literals in ${PROMPT_RS}`;

if (frozen.size > 0) {
  const total = [...frozen.values()].reduce((a, b) => a + b, 0);
  const where = [...frozen.entries()]
    .map(
      ([dir, n]) =>
        `${rel(dir)
          .replace(/^test-cases\/[^/]+\/[^/]+\//, "")
          .replace(/^game-jams\//, "")} (${n})`,
    )
    .join(", ");
  console.log(
    `spec-vocabulary-check: skipped ${total} hit(s) in ${frozen.size} frozen version(s), which cannot be edited: ${where}${SHOW_FROZEN ? "" : " — rerun with --show-frozen to list them"}`,
  );
}

if (failures.length > 0) {
  console.error(
    "\nA seeded spec or prompt names what a model must not learn:\n",
  );
  for (const f of failures) console.error(`${f.path}:${f.line}: ${f.text}`);
  const byRule = new Map();
  for (const f of failures)
    for (const rule of f.rules) byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
  console.error("\nRules that fired:");
  for (const [rule, n] of byRule)
    console.error(`  ${rule.name} (${n}): ${rule.why}`);
  console.error(`
These files are seeded into a model's workspace, or prepended to its prompt.
Reword so the sentence describes the game or the asset rather than the machinery
around a run. Naming a *reviewer* is fine; naming our surfaces, our tooling, or a
benchmark is not. Never rename \`tcab-blend\`. See the header of this script.`);
  process.exit(1);
}

console.log(
  `Seeded specs and prompts name nothing about evaluation (${checked}; ${frozenVersions} frozen versions reported, not failed).`,
);
