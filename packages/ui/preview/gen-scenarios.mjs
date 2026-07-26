// Generates the six splitter demo scenarios into scenarios.json, which the preview
// (scenarios.ts) imports. Each input belt is built so its two lanes carry DIFFERENT
// items: one lane from a straight source, the other side-loaded from a perpendicular
// feeder (a source can only emit one item per lane, and a belt has one upstream tile).
// Run: node packages/ui/preview/gen-scenarios.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const src = (x, y, dir, item, lane = "both") => ({ type: "source", x, y, dir, item, lane, period: 1 });
const belt = (x, y, dir) => ({ type: "belt", x, y, dir, tier: "fast" });
const splitter = (x, y) => ({ type: "splitter", x, y, dir: "E" });
const sink = (x, y) => ({ type: "sink", x, y, dir: "W" });

// An east-bound output belt: two belt tiles into a sink, so items flow and drain.
const output = (x, y) => [belt(x, y, "E"), belt(x + 1, y, "E"), sink(x + 2, y)];

// A two-lane input belt ending at (ex, ey), flowing E, with `left`/`right` items on
// its two lanes. Side-loading fills the target lane on the side the feeder is on. For
// the TOP input the feeder comes from the NORTH (above) — which lands on the LEFT lane
// — so `left` is the side-loaded item and `right` comes straight from an E source
// (lane "right"). Keeping the feeder above stays clear of the belt below.
const inputTop = (ex, ey, left, right) => [
  src(ex - 2, ey, "E", right, "right"),
  belt(ex - 1, ey, "E"),
  belt(ex, ey, "E"),
  src(ex - 1, ey - 2, "S", left),
  belt(ex - 1, ey - 1, "S"),
];

// The BOTTOM input's feeder comes from the SOUTH (below) — landing on the RIGHT lane —
// so `right` is side-loaded and `left` comes straight from an E source (lane "left").
const inputBottom = (ex, ey, left, right) => [
  src(ex - 2, ey, "E", left, "left"),
  belt(ex - 1, ey, "E"),
  belt(ex, ey, "E"),
  src(ex - 1, ey + 2, "N", right),
  belt(ex - 1, ey + 1, "N"),
];

// A single-lane (left) input belt ending at (ex, ey).
const inputOneLane = (ex, ey, item) => [
  src(ex - 2, ey, "E", item, "left"),
  belt(ex - 1, ey, "E"),
  belt(ex, ey, "E"),
];

// The splitter sits at column 5; inputs feed column 4; outputs start at column 6.
// Rows: top input y=4, bottom input y=5. Feeders occupy y=2..3 (top) and y=6..7 (bottom).
const SX = 5;
const TOP = 4;
const BOT = 5;
const scene = (entities) => ({
  version: 1,
  grid: { width: 11, height: 10 },
  ticks: 100000,
  snapshots: [100000],
  entities: [splitter(SX, TOP), ...entities],
});

// Distinct items so every populated lane is visually different.
const IO = "iron-ore";
const IP = "iron-plate";
const CO = "copper-ore";
const CP = "copper-plate";

const PRESETS = [
  {
    name: "1. One belt, both lanes, two outputs",
    blurb:
      "One input belt (iron-ore top lane, iron-plate bottom lane) into two outputs. Both lanes of BOTH outputs should fill — iron-ore alternating across the two top lanes, iron-plate across the two bottom lanes. This is the unzip that was broken.",
    scenario: scene([
      ...inputTop(4, TOP, IO, IP),
      ...output(SX + 1, TOP),
      ...output(SX + 1, BOT),
    ]),
  },
  {
    name: "2. One belt, one lane, one output",
    blurb:
      "One input belt with only the top lane populated (iron-ore) into a single output. It stays on the top lane of that output.",
    scenario: scene([...inputOneLane(4, TOP, IO), ...output(SX + 1, TOP)]),
  },
  {
    name: "3. Two belts, both lanes, one output",
    blurb:
      "Two full input belts (top: iron-ore/iron-plate, bottom: copper-ore/copper-plate) into ONE output. Each output lane interleaves its two same-side inputs (top lane alternates iron-ore/copper-ore, bottom lane iron-plate/copper-plate); the inputs back up since one belt cannot absorb two.",
    scenario: scene([
      ...inputTop(4, TOP, IO, IP),
      ...inputBottom(4, BOT, CO, CP),
      ...output(SX + 1, TOP),
    ]),
  },
  {
    name: "4. Two belts, both lanes, two outputs",
    blurb:
      "Two full input belts into two outputs. Every output lane carries a balanced mix of its two same-side inputs, and no item ever crosses lanes.",
    scenario: scene([
      ...inputTop(4, TOP, IO, IP),
      ...inputBottom(4, BOT, CO, CP),
      ...output(SX + 1, TOP),
      ...output(SX + 1, BOT),
    ]),
  },
  {
    name: "5. Two belts (one full, one half), one output",
    blurb:
      "Top belt full (iron-ore/iron-plate), bottom belt only its top lane (copper-ore), into ONE output. The output's top lane interleaves iron-ore/copper-ore; its bottom lane carries iron-plate only.",
    scenario: scene([
      ...inputTop(4, TOP, IO, IP),
      ...inputOneLane(4, BOT, CO),
      ...output(SX + 1, TOP),
    ]),
  },
  {
    name: "6. Two belts (one full, one half), two outputs",
    blurb:
      "Top belt full, bottom belt only its top lane, into two outputs. The two top-lane inputs spread across both outputs' top lanes; the single bottom-lane input spreads across both outputs' bottom lanes.",
    scenario: scene([
      ...inputTop(4, TOP, IO, IP),
      ...inputOneLane(4, BOT, CO),
      ...output(SX + 1, TOP),
      ...output(SX + 1, BOT),
    ]),
  },
];

writeFileSync(join(here, "scenarios.json"), JSON.stringify(PRESETS, null, 2) + "\n");
console.log(`wrote scenarios.json (${PRESETS.length} presets)`);
