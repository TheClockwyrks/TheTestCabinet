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

// The top bands are deterministic: circuit unit (rows 0–6, the full copper chain
// copper-ore→copper-plate→copper-cable→circuit plus an iron-plate feed), gear unit
// (rows 7–9, iron-ore→iron-plate→iron-gear), smelt unit (rows 10–20, an ore bus
// tapped into a wide row of plate assemblers with a curve + side-load merge), then a
// two-row ore belt unit carrying a splitter. Cropping at a band boundary keeps the
// slice self-contained. Large runs a band deeper to also show a farm unit — a whole
// row of assemblers tapped straight off one ore bus, the density workhorse.
const PREVIEW = [
  {
    name: "Medium factory — top (copper chain + iron chain + smelt)",
    blurb:
      "A portion of the held-out `medium` scored scenario (48×32): every source emits only raw ore. Top band crafts circuits from a real copper chain (copper-ore→copper-plate→copper-cable) merged with an iron-plate feed; below it iron-ore→iron-plate→iron-gear, then an ore bus tapped into a wide row of plate assemblers (curve + side-load merge) and a balancing splitter.",
    scenario: cropTop(read("medium.json"), 23, 5000),
  },
  {
    name: "Large factory — top (chains + smelt + assembler farm)",
    blurb:
      "A portion of the held-out `large` scored scenario (72×40): the same ore-only craft tree, one band deeper to include a farm unit — a full row of assemblers tapped straight off one ore bus, dumping to sinks. Shows the density (empty-belt ~11%) and the full copper→circuit chain.",
    scenario: cropTop(read("large.json"), 30, 5000),
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
