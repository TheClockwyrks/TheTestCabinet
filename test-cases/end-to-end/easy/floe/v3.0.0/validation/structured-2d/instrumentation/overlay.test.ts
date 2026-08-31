// instrumentation/overlay — the debug overlay reports the game beneath it, and
// reads it without changing it.
//
// specs/instrumentation.md fixes what the panel must say, under Diagnostics:
// "Register at least the current `screen` and `phase`, the level, the lives, the
// score and the timer, the critter's tile, center, facing and footing, each bear's
// id, tile, center, facing, swimming flag and target, how many vehicles and floes
// are on the strait, and which bays are filled, the same facts the snapshot
// reports. Keep each one short enough to read on a line, and keep every source a
// pure read, so watching the overlay leaves the game as it is." Under this engine
// the panel is the ENGINE's: "Registering those values is the whole of Floe's
// part, through `world.diagnostics` in the game mode's `beginPlay` ... Drawing the
// panel and toggling it are the engine's."
//
// THAT THE KEY TOGGLES IT IS `controls/overlay-backquote`'S POINT, NOT THIS ONE'S.
// This one is about the CONTENTS: a build that registers nothing still shows and
// hides an engine panel, and loses here while keeping that one.
//
// HOW A FACT IS READ. The recorder hands back every operation one frame's render
// issued, so the panel's contents are the text that frame drew. The baseline is
// the same frame with the overlay away, subtracted run for run, so the HUD's own
// readouts — which specs/ui.md already puts the level, lives, score, timer and
// bays on — cancel out and what remains is the panel's own text. THE ENGINE'S OWN
// TWO LINES ARE THEN DROPPED: it heads the panel with the world's status
// (`level: … phase: … actors: …`) and foots it with its frame timings
// (`frame: … ms`), and neither is a registered source, so counting either would
// let the engine answer for the build. A fact is then looked for as a STANDALONE
// TOKEN in what is left, so `13` is not found inside `130`. Nothing here asserts a
// layout, a label, an order or a format: a build may name and lay its sources out
// however it likes.
//
// THE POSED STRAIT IS BUILT SO EVERY FACT IS ITS OWN NUMBER. The level, the lives,
// the score, the timer, the critter's tile and center, the bear's tile, center and
// target, and the two counts are sixteen figures with no two alike, so a build
// that omits one of them fails on that one rather than passing on another fact's
// digits. That each of them landed where it was posed is asserted as a
// PRECONDITION before the panel is read, and the value the panel is then held to
// is the one the SNAPSHOT reports rather than the one this file posed: the
// requirement is that the overlay says what the game says. The two enum facts —
// the critter's facing `left` and the bear's facing `right` — are likewise
// different words, and the footing is posed `solid` rather than `floe` because
// `floe` is a word a floe COUNT is likely to be labelled with.
//
// THE TWO FACTS WITH NO DISTINGUISHING RENDERING ARE READ AS CHANGES INSTEAD. A
// swimming flag is a boolean and a bay is five of them, and a build is free to
// draw either as a word, a letter or a mark, so there is no token to look for.
// Each is therefore changed under a shown panel and the panel's registered text
// must change with it: the bear's step tile is uncovered by moving a floe off it,
// which leaves the floe COUNT alone, and one more bay is filled. Nothing else the
// sources read moves across those two readings — every lane is parked and every
// faculty of the one bear is off — so a panel whose text is identical either time
// is one that reports neither. That is a necessary condition rather than a
// sufficient one, which is why the facts above are read as values and only these
// two as changes.
//
// AND A CONTROL READING IS TAKEN FIRST, so that comparison decides something. Two
// panels are read back to back with NOTHING changed between them, and any line
// that differs across that pair is one the panel redraws on its own whatever the
// game does — a line that would make "the text changed" true however little the
// build reports. Those lines are dropped from both comparisons. The engine's frame
// timings are the obvious one, and they are already out with the chrome above;
// the control is what makes the comparison sound without this file having to know
// what else a panel might redraw.
//
// AND THE SNAPSHOT IS COMPARED ACROSS THE TOGGLE. specs/instrumentation.md makes
// every source a pure read, so every field the snapshot reports must be exactly as
// it was, `muted` included; `simTime` is left out of the comparison because
// delivering a key press takes a tick and that field "adds `TICK_DT` on every tick
// whatever the screen".

import { afterEach, beforeEach, it } from "vitest";
import { tileCX, tileCY, tileLeft } from "../../src/constants";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  poseBear,
  poseLane,
  startCrossing,
  toggleOverlay,
  type Facing,
  type FloeKind,
  type FloeSnapshot,
  type Harness,
  type VehicleKind,
} from "../harness";
import { requireBear } from "./roster";

/** The run posed under the panel: four figures, none of them alike. */
const LEVEL = 6;
const LIVES = 2;
const SCORE = 730;
const TIMER = 17;

/** The critter: a tile on the ice band, so its footing is `solid`. */
const CRITTER_COL = 9;
const CRITTER_ROW = 13;
const CRITTER_FACING: Facing = "left";

/** The bear: a water-band tile, with a step and a target of its own. */
const BEAR_COL = 33;
const BEAR_ROW = 7;
const BEAR_STEP: Facing = "right";
const BEAR_TARGET = { col: 27, row: 12 };

/** The floe covering the bear's step tile, and the column it is moved to. */
const COVER_COL = BEAR_COL + 1;
const UNCOVER_COL = 25;

/** The rest of the traffic, posed so the two counts are two distinct figures. */
const VEHICLE_ROW = 15;
const VEHICLE_KIND: VehicleKind = "car";
const VEHICLE_COLS: readonly number[] = [1, 6, 11, 16];
const FLOE_KIND: FloeKind = "pan";
const FLOE_ROW = BEAR_ROW;
const FLOE_COLS: readonly number[] = [2, COVER_COL];
const SPARE_FLOE_ROW = 4;
const SPARE_FLOE_COLS: readonly number[] = [20];

/** The bays posed filled, and the one filled again for the second reading. */
const FILLED_BAYS: readonly number[] = [1, 3];
const EXTRA_BAY = 0;

/** How many vehicles and floes the pose leaves on the strait. */
const VEHICLE_COUNT = VEHICLE_COLS.length;
const FLOE_COUNT = FLOE_COLS.length + SPARE_FLOE_COLS.length;

/**
 * The two lines the ENGINE contributes to its own panel, which no build registers.
 *
 * The engine heads the panel with the open world's status and foots it with the
 * frame timings it measured (engine/diagnostics.md). Neither is a source the game
 * named, and the second carries a figure that differs on every frame, so both are
 * dropped before the panel is read: counting the first would let the engine's
 * actor count stand in for a fact the build never registered, and counting the
 * second would make "the panel's text changed" true whatever the build drew.
 */
const ENGINE_CHROME: readonly RegExp[] = [
  /^level: .+ {2}phase: .+ {2}actors: \d+$/,
  /^frame: .* ms$/,
];

/** The registered sources' own lines: the panel's text, less the engine's two. */
function sourceLines(panel: readonly string[]): string[] {
  return panel.filter(
    (run) => !ENGINE_CHROME.some((chrome) => chrome.test(run)),
  );
}

/** The text one frame drew, minus the text the same frame drew without a panel. */
function panelText(
  shown: readonly string[],
  hidden: readonly string[],
): string[] {
  const rest = [...hidden];
  const own: string[] = [];
  for (const run of shown) {
    const at = rest.indexOf(run);
    if (at === -1) own.push(run);
    else rest.splice(at, 1);
  }
  return own;
}

/** A run's label: the text before its first colon, or the whole run. */
function labelOf(run: string): string {
  const at = run.indexOf(":");
  return at === -1 ? run : run.slice(0, at);
}

/**
 * The labels of every run that is not in BOTH readings, as a multiset difference.
 *
 * Read over a pair taken with nothing changed between them, these are the lines
 * the panel redraws on its own, and dropping them is what leaves a comparison that
 * only a reported change can move.
 */
function volatileLabels(
  a: readonly string[],
  b: readonly string[],
): Set<string> {
  const labels = new Set<string>();
  const rest = [...b];
  for (const run of a) {
    const at = rest.indexOf(run);
    if (at === -1) labels.add(labelOf(run));
    else rest.splice(at, 1);
  }
  for (const run of rest) labels.add(labelOf(run));
  return labels;
}

/** One reading, less every run whose label the control pair found volatile. */
function steady(
  panel: readonly string[],
  volatile: ReadonlySet<string>,
): string {
  return panel.filter((run) => !volatile.has(labelOf(run))).join("\n");
}

/** Whether the panel drew `value` as a standalone token, ignoring case. */
function reports(panel: readonly string[], value: string | number): boolean {
  const wanted = String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^A-Za-z0-9])${wanted}([^A-Za-z0-9]|$)`, "i");
  return panel.some((run) => pattern.test(run));
}

/** The snapshot fields that differ between two readings, `simTime` apart. */
function driftedFields(before: FloeSnapshot, after: FloeSnapshot): string[] {
  return (Object.keys(before) as (keyof FloeSnapshot)[])
    .filter((field) => field !== "simTime")
    .filter(
      (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
    );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Show the panel, read the registered text it added to the frame, and hide it
 * again.
 *
 * The frame with the panel away is read first, so the subtraction is against the
 * very same picture rather than against one taken under a different state.
 */
async function readPanel(harness: Harness, still?: string): Promise<string[]> {
  harness.calls.length = 0;
  await harness.advance(1);
  const hidden = drawnText(harness.calls);

  harness.calls.length = 0;
  await toggleOverlay(harness);
  const shown = drawnText(harness.calls);
  if (still !== undefined) captureStill(harness, still);

  await toggleOverlay(harness);
  return sourceLines(panelText(shown, hidden));
}

it("draws the facts the specification lists and leaves the game as it was", async () => {
  startCrossing(h, LEVEL);
  h.debug.setLives(LIVES);
  h.debug.setScore(SCORE);
  h.debug.setTimer(TIMER);
  for (const bay of FILLED_BAYS) h.debug.setBay(bay, true);

  h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);
  h.debug.setCritterFacing(CRITTER_FACING);

  poseLane(h, VEHICLE_ROW, VEHICLE_KIND, VEHICLE_COLS);
  const [, cover] = poseLane(h, FLOE_ROW, FLOE_KIND, FLOE_COLS);
  poseLane(h, SPARE_FLOE_ROW, FLOE_KIND, SPARE_FLOE_COLS);

  // Every faculty off, so the bear holds the tile, the step and the target this
  // pose gives it for as long as the panel is read.
  const bear = poseBear(h, BEAR_COL, BEAR_ROW, {
    sense: false,
    routing: false,
    travel: false,
  });
  h.debug.setBearTarget(bear, BEAR_TARGET.col, BEAR_TARGET.row);
  h.debug.setBearStep(bear, BEAR_STEP);

  const before = h.snapshot();
  const posedBear = requireBear(before, bear, "the posed bear");

  // The scenario really is the distinguishing one: sixteen figures with no two
  // alike, each where this file put it. A pose that landed elsewhere would make
  // the readings below ambiguous rather than wrong, so it is named here.
  const preconditions: readonly (readonly [string, unknown, unknown])[] = [
    ["the level posed", before.level, LEVEL],
    ["the lives posed", before.lives, LIVES],
    ["the score posed", before.score, SCORE],
    ["the crossing timer posed", before.timer, TIMER],
    ["the critter's column", before.critter.col, CRITTER_COL],
    ["the critter's row", before.critter.row, CRITTER_ROW],
    ["the critter's center x", before.critter.x, tileCX(CRITTER_COL)],
    ["the critter's center y", before.critter.y, tileCY(CRITTER_ROW)],
    ["the critter's facing", before.critter.facing, CRITTER_FACING],
    ["the critter's footing", before.critter.footing, "solid"],
    ["the bear's column", posedBear.col, BEAR_COL],
    ["the bear's row", posedBear.row, BEAR_ROW],
    ["the bear's center x", posedBear.x, tileCX(BEAR_COL)],
    ["the bear's center y", posedBear.y, tileCY(BEAR_ROW)],
    ["the bear's target column", posedBear.target.col, BEAR_TARGET.col],
    ["the bear's target row", posedBear.target.row, BEAR_TARGET.row],
    ["the vehicles on the strait", before.vehicles.length, VEHICLE_COUNT],
    ["the floes on the strait", before.floes.length, FLOE_COUNT],
    ["the bears on the strait", before.bears.length, 1],
  ];
  for (const [what, actual, expected] of preconditions) {
    assertEqual(
      actual,
      expected,
      `${what}, which this scenario poses so that every fact the panel must ` +
        `report is its own figure — the panel is read against it below`,
    );
  }

  const panel = await readPanel(h, "overlay");
  const after = h.snapshot();

  assertGreaterThan(
    panel.length,
    0,
    "the runs of registered text the shown overlay drew over the frame the " +
      "hidden one drew — the overlay draws the sources the game registered " +
      "(specs/instrumentation.md)",
  );

  // Every fact with a distinguishing rendering, read as the value the SNAPSHOT
  // reports: the panel must say what the game says.
  const facts: readonly (readonly [string, string | number])[] = [
    ["the screen", before.screen],
    ["the phase", before.phase],
    ["the level", before.level],
    ["the lives", before.lives],
    ["the score", before.score],
    ["the crossing timer", before.timer],
    ["the critter's column", before.critter.col],
    ["the critter's row", before.critter.row],
    ["the critter's center x", before.critter.x],
    ["the critter's center y", before.critter.y],
    ["the critter's facing", before.critter.facing],
    ["the critter's footing", before.critter.footing],
    ["the bear's id", posedBear.id],
    ["the bear's column", posedBear.col],
    ["the bear's row", posedBear.row],
    ["the bear's center x", posedBear.x],
    ["the bear's center y", posedBear.y],
    ["the bear's facing", posedBear.facing],
    ["the bear's target column", posedBear.target.col],
    ["the bear's target row", posedBear.target.row],
    ["how many vehicles are on the strait", before.vehicles.length],
    ["how many floes are on the strait", before.floes.length],
  ];
  for (const [what, value] of facts) {
    assertTrue(
      reports(panel, value),
      `${what}, ${JSON.stringify(String(value))}, drawn as a standalone token ` +
        `somewhere in the overlay's registered sources — ` +
        `specs/instrumentation.md lists it among the facts the panel registers. ` +
        `What those sources drew: ${JSON.stringify(panel)}`,
    );
  }

  // The overlay read the game and left it exactly as it was.
  assertDeepEqual(
    driftedFields(before, after),
    [],
    "the snapshot fields that moved across showing and hiding the overlay — " +
      "every source is a pure read (specs/instrumentation.md)",
  );

  // A second reading with nothing changed between it and the first, so the two
  // comparisons below are made over the lines that only a reported change moves.
  const control = await readPanel(h);
  const volatile = volatileLabels(panel, control);

  // The two boolean facts, read as changes the panel must follow.
  h.debug.setFloeX(cover, tileLeft(UNCOVER_COL));
  const swimming = h.snapshot();
  assertTrue(
    requireBear(swimming, bear, "the bear over open water").swimming !==
      posedBear.swimming,
    `the bear's swimming flag after the floe covering its step tile was moved ` +
      `off it, against what it read before — this point cannot hold the panel to ` +
      `a fact the scenario never changed`,
  );
  assertEqual(
    swimming.floes.length,
    FLOE_COUNT,
    "the floes still on the strait, of which the move changed none: the count " +
      "the panel reports is the same on both readings, so only the swimming " +
      "flag differs",
  );
  const swum = await readPanel(h);
  assertTrue(
    steady(swum, volatile) !== steady(control, volatile),
    `the overlay's registered text with the bear over open water, against its ` +
      `text with a floe under the tile it is travelling into — ` +
      `specs/instrumentation.md lists each bear's swimming flag among the facts ` +
      `the panel reports`,
  );

  h.debug.setBay(EXTRA_BAY, true);
  const filled = await readPanel(h);
  assertTrue(
    steady(filled, volatile) !== steady(swum, volatile),
    `the overlay's registered text with bay ${EXTRA_BAY} filled, against its ` +
      `text with that bay open — specs/instrumentation.md lists which bays are ` +
      `filled among the facts the panel reports`,
  );
});
