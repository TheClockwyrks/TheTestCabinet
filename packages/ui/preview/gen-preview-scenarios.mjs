// Crops a representative PORTION out of the held-out scored `bus` scenarios
// (cases/medium.json, cases/large.json) into preview-scenarios.json, which the
// playback preview (preview-scenarios.ts) imports so the interconnected main-bus
// factories can be eyeballed WITHOUT rebuilding containers, re-ingesting the case,
// and doing a full run. Each crop is a self-contained top slice — the `route` unit
// (an iron-plate bus split to two different recipes: iron-gear and the two-input
// circuit) plus the `smelt` unit (an ore bus tapped by inserters into plate
// assemblers whose product curves and side-loads onto a collector) — so it renders
// and flows on its own, showing every interconnection pattern the redesign added.
//
// It is a PORTION, not the whole factory: the crop keeps only entities whose full
// footprint sits inside the sliced rows, and the slice ends on a band boundary (the
// bus-units stack in non-overlapping horizontal bands), so the result is always a
// valid scenario. The ticks are shortened for watchability. This is a dev preview,
// not part of the scored set — the committed .out oracles are untouched.
//
// Run: node packages/ui/preview/gen-preview-scenarios.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const casesDir = join(
  here,
  "../../../test-cases/performance/hard/lattice/v1.0.0/cases",
);

// The footprint tiles an entity occupies — the anchor plus any extra tiles for the
// multi-tile shapes (splitter's second tile, the assembler's 3×3). Matches
// `Scenario::validate` / the renderer's footprint model so a kept entity is always
// wholly inside the crop.
function footprint(e) {
  if (e.type === "assembler") {
    const tiles = [];
    for (let dy = 0; dy < 3; dy++)
      for (let dx = 0; dx < 3; dx++) tiles.push([e.x + dx, e.y + dy]);
    return tiles;
  }
  if (e.type === "splitter") {
    // Second tile is one step perpendicular-clockwise of `dir` (E/W → (x, y+1);
    // N/S → (x+1, y)). The bus layout only emits east-facing splitters.
    const second =
      e.dir === "E" || e.dir === "W" ? [e.x, e.y + 1] : [e.x + 1, e.y];
    return [[e.x, e.y], second];
  }
  return [[e.x, e.y]];
}

// Keep the top `rows` rows of a scenario as a standalone scenario. Because the crop
// starts at row 0 there is no re-anchoring; an entity is kept iff its whole
// footprint fits in the kept rows (a band boundary drops nothing, since bands never
// straddle it). Ticks are shortened for the preview.
function cropTop(scenario, rows, ticks) {
  const entities = scenario.entities.filter((e) =>
    footprint(e).every(([, fy]) => fy >= 0 && fy < rows),
  );
  return {
    version: scenario.version,
    grid: { width: scenario.grid.width, height: rows },
    ticks,
    snapshots: [Math.round(ticks / 4), Math.round(ticks / 2), ticks],
    entities,
  };
}

const read = (name) =>
  JSON.parse(readFileSync(join(casesDir, name), "utf8"));

// The main-bus factory fills the whole grid (machinery edge to edge), so — unlike
// the old banded layout — there is no clean top-of-grid slice; the preview shows the
// WHOLE factory at a shortened tick count. `cropTop` with the full height keeps every
// entity and just re-times the run; ~24k ticks is long enough that the sub-buses have
// filled and the stations are steadily crafting, so a viewer sees the finished flow
// (ore smelted on the left, plate/copper sub-buses running east lined with gear and
// cable stations, the machine works building circuit → transport-belt → inserter →
// assembler, belts of all three tiers moving at their own speeds, single-item sinks).
const PREVIEW = [
  {
    name: "Medium factory (48×32 main bus)",
    blurb:
      "The whole held-out `medium` scored scenario (48×32) at a shortened tick count. A real main bus: every source emits only raw ore on the far left, rerouted by splitters into plate smelters; iron- and copper-plate sub-buses then run east across the grid lined with gear and cable stations, and a machine works builds circuit, transport-belt, inserter, and assembler (a belt fed forward into the assembler). Machinery spans the full width; belts of all three tiers move at their own speeds; every sink takes one item.",
    scenario: cropTop(read("medium.json"), 32, 24000),
  },
  {
    name: "Large factory (72×40 main bus)",
    blurb:
      "The whole held-out `large` scored scenario (72×40) at a shortened tick count — the same main-bus design, wider and taller: more sub-bus lanes, more product stations spread across the interior, and the full copper→cable→circuit chain feeding the machine works. Shows the ore rerouting on the left, the tapped intermediate buses, machine crafting through to single-item sinks, and the tiered belt speeds.",
    scenario: cropTop(read("large.json"), 40, 24000),
  },
];

writeFileSync(
  join(here, "preview-scenarios.json"),
  JSON.stringify(PREVIEW, null, 2) + "\n",
);
console.log(
  `wrote preview-scenarios.json (${PREVIEW.length} scored-scenario portions)`,
);
for (const p of PREVIEW)
  console.log(
    `  ${p.name}: ${p.scenario.grid.width}x${p.scenario.grid.height}, ${p.scenario.entities.length} entities`,
  );
