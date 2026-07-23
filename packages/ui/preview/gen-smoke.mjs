// Generates the smoke-test scenarios. Each is a tiny scenario that exercises ONE
// core behavior in isolation, with a short run and a simple expected outcome — the
// cheap correctness pre-flight the performance test case runs before the expensive
// stress scenarios. This is the SINGLE source for those smoke tests: it writes both
//   - packages/ui/preview/smoke.json — the preview's playable + pass/fail list, and
//   - test-cases/performance/hard/lattice/v1.0.0/smoke/<id>.json — the held-out
//     scenario the validator grades (its `.out` oracle is produced by `lattice solve`).
// Run: node packages/ui/preview/gen-smoke.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// The lattice test case's smoke/ folder, relative to this preview dir.
const smokeDir = join(
  here,
  "../../../test-cases/performance/hard/lattice/v1.0.0/smoke",
);

const src = (x, y, dir, item, lane = "both", period = 1) => ({
  type: "source",
  x,
  y,
  dir,
  item,
  lane,
  period,
});
const belt = (x, y, dir) => ({ type: "belt", x, y, dir, tier: "fast" });
const splitter = (x, y) => ({ type: "splitter", x, y, dir: "E" });
const sink = (x, y) => ({ type: "sink", x, y, dir: "W" });
const inserter = (x, y, dir) => ({ type: "inserter", x, y, dir });
const assembler = (x, y, recipe) => ({ type: "assembler", x, y, recipe }); // 3x3 anchored top-left

// A handful of checkpoints across the run (not just the final tick), so the oracle
// comparison catches a divergence partway through, not only the end state.
const snaps = (t) => [
  ...new Set([Math.max(1, Math.round(t / 3)), Math.round((2 * t) / 3), t]),
];
const scene = (w, h, ticks, entities) => ({
  version: 1,
  grid: { width: w, height: h },
  ticks,
  snapshots: snaps(ticks),
  entities,
});

const SMOKE = [
  {
    id: "belt-transport",
    name: "Belts carry items to a sink",
    blurb:
      "A source feeds a straight belt run into a sink. Confirms belts move items across tile seams and a sink consumes them.",
    expected: "the sink consumes iron-ore",
    ticks: 60,
    scenario: scene(7, 4, 60, [
      src(0, 1, "E", "iron-ore"),
      belt(1, 1, "E"),
      belt(2, 1, "E"),
      belt(3, 1, "E"),
      sink(4, 1),
    ]),
  },
  {
    id: "side-load",
    name: "Side-loading fills the correct lane, both sides",
    blurb:
      "Iron side-loads from the NORTH (→ top lane) and copper from the SOUTH (→ bottom lane) onto one belt. Confirms a side-load lands on the lane matching the side it comes from.",
    expected:
      "the belt carries iron on the top lane and copper on the bottom lane",
    ticks: 60,
    scenario: scene(7, 7, 60, [
      // main belt
      belt(3, 3, "E"),
      belt(4, 3, "E"),
      sink(5, 3),
      // iron from the north (S-flowing feeder) -> top/left lane
      src(3, 1, "S", "iron-ore"),
      belt(3, 2, "S"),
      // copper from the south (N-flowing feeder) -> bottom/right lane
      src(3, 5, "N", "copper-ore"),
      belt(3, 4, "N"),
    ]),
  },
  {
    id: "splitter",
    name: "Splitter balances one belt across both outputs",
    blurb:
      "One belt (iron-ore top lane, iron-plate bottom lane) into two outputs. Confirms BOTH outputs get BOTH lanes — the fix for the 'unzip' where each output got only one lane.",
    expected: "both output sinks consume BOTH iron-ore and iron-plate",
    ticks: 120,
    scenario: scene(11, 8, 120, [
      splitter(5, 4),
      // one two-lane input feeding (4,4): iron-ore top (side-load from north), iron-plate bottom (straight, right lane)
      src(2, 4, "E", "iron-plate", "right"),
      belt(3, 4, "E"),
      belt(4, 4, "E"),
      src(3, 2, "S", "iron-ore"),
      belt(3, 3, "S"),
      // two outputs, each to a sink
      belt(6, 4, "E"),
      sink(7, 4),
      belt(6, 5, "E"),
      sink(7, 5),
    ]),
  },
  {
    id: "inserter-belt-belt",
    name: "Inserter moves items between belts (top → bottom)",
    blurb:
      "A south-facing inserter lifts items off a top east-belt and drops them onto a bottom east-belt, which drains to a sink. Confirms an inserter hands items across belts (and moves them top-to-bottom, i.e. a rotated inserter).",
    expected: "the bottom sink consumes iron-ore",
    ticks: 100,
    scenario: scene(7, 6, 100, [
      // top belt
      src(0, 1, "E", "iron-ore", "both", 3),
      belt(1, 1, "E"),
      belt(2, 1, "E"),
      // inserter picks from the top belt (behind, north) and drops onto the bottom belt (front, south)
      inserter(2, 2, "S"),
      // bottom belt to a sink
      belt(2, 3, "E"),
      belt(3, 3, "E"),
      sink(4, 3),
    ]),
  },
  {
    id: "assembler-single",
    name: "Assembler crafts; inserters feed and unload it",
    blurb:
      "Belt → inserter → assembler (iron-ore → iron-plate) → inserter → sink. Confirms an assembler crafts, an inserter feeds its input, and another inserter unloads its output.",
    expected: "the sink consumes iron-plate (crafted from iron-ore)",
    ticks: 300,
    scenario: scene(10, 5, 300, [
      src(0, 2, "E", "iron-ore", "both", 3),
      belt(1, 2, "E"),
      belt(2, 2, "E"),
      inserter(3, 2, "E"), // feeds the assembler input
      assembler(4, 1, "iron-plate"), // covers (4,1)-(6,3)
      inserter(7, 2, "E"), // unloads the assembler output
      sink(8, 2),
    ]),
  },
  {
    id: "assembler-two-input",
    name: "Assembler crafts a two-input recipe",
    blurb:
      "Two feeds (iron-plate from the west, copper-cable from the north) into one assembler making circuits, unloaded to a sink. Confirms multi-input recipes and two inserters feeding one machine.",
    expected: "the sink consumes circuits (iron-plate + copper-cable×3)",
    ticks: 600,
    scenario: scene(10, 8, 600, [
      // iron-plate feed from the west
      src(0, 3, "E", "iron-plate", "both", 2),
      belt(1, 3, "E"),
      belt(2, 3, "E"),
      inserter(3, 3, "E"), // feeds iron-plate to (4,3)
      // copper-cable feed from the north
      src(5, 0, "S", "copper-cable", "both", 1),
      belt(5, 1, "S"),
      inserter(5, 2, "S"), // feeds copper-cable to (5,3)
      assembler(4, 3, "circuit"), // covers (4,3)-(6,5)
      inserter(7, 4, "E"), // unloads circuits from (6,4)
      sink(8, 4),
    ]),
  },
  {
    id: "curve",
    name: "A belt turns a corner (curve)",
    blurb:
      "A source feeds an east belt run that turns south and drains to a sink. Confirms a curve — a belt whose sole input is a perpendicular neighbour — carries BOTH lanes across the 90° turn (the base ruleset remaps them equal-length).",
    expected: "the sink consumes iron-ore after the belt turns the corner",
    ticks: 80,
    scenario: scene(7, 7, 80, [
      // an east run …
      src(0, 1, "E", "iron-ore"),
      belt(1, 1, "E"),
      belt(2, 1, "E"),
      belt(3, 1, "E"), // flows east into (4,1)
      // … that turns south: (4,1) faces S, perpendicular to the E belt feeding it
      belt(4, 1, "S"),
      belt(4, 2, "S"),
      belt(4, 3, "S"), // flows south into the sink
      sink(4, 4),
    ]),
  },
  {
    id: "craft-chain",
    name: "Two-stage crafting (plate → gear)",
    blurb:
      "iron-ore is smelted to iron-plate by one assembler, then two plates are crafted into an iron-gear by a second, the stages linked by an inserter and a belt. Confirms one assembler's output feeds the next machine's input.",
    expected: "the sink consumes iron-gear (crafted from iron-plate, itself crafted from iron-ore)",
    ticks: 900,
    scenario: scene(17, 5, 900, [
      // stage 1: iron-ore -> iron-plate
      src(0, 2, "E", "iron-ore", "both", 2),
      belt(1, 2, "E"),
      belt(2, 2, "E"),
      inserter(3, 2, "E"), // feeds ore to the plate assembler at (4,2)
      assembler(4, 1, "iron-plate"), // covers (4,1)-(6,3)
      inserter(7, 2, "E"), // unloads plate from (6,2) onto the link belt
      // link belt carrying plate to stage 2
      belt(8, 2, "E"),
      belt(9, 2, "E"),
      // stage 2: iron-plate ×2 -> iron-gear
      inserter(10, 2, "E"), // feeds plate to the gear assembler at (11,2)
      assembler(11, 1, "iron-gear"), // covers (11,1)-(13,3)
      inserter(14, 2, "E"), // unloads gear from (13,2) into the sink
      sink(15, 2),
    ]),
  },
];

writeFileSync(join(here, "smoke.json"), JSON.stringify(SMOKE, null, 2) + "\n");
console.log(`wrote smoke.json (${SMOKE.length} smoke tests)`);

// Mirror each scenario into the test case's held-out smoke/ folder. The `.out`
// oracle for each is generated separately with `lattice solve`.
mkdirSync(smokeDir, { recursive: true });
for (const t of SMOKE) {
  writeFileSync(
    join(smokeDir, `${t.id}.json`),
    JSON.stringify(t.scenario, null, 2) + "\n",
  );
}
console.log(`wrote ${SMOKE.length} scenarios to ${smokeDir}`);
