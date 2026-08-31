// Floe — instrumentation/overlay: the debug overlay reports the game beneath it,
// and reads it without changing it.
//
// `specs/instrumentation.md` fixes what the panel must say, under Diagnostics:
// "Register at least the current `screen` and `phase`, the level, the lives, the
// score and the timer, the critter's tile, center, facing and footing, each
// bear's id, tile, center, facing, swimming flag and target, how many vehicles
// and floes are on the strait, and which bays are filled, the same facts the
// snapshot reports. Keep each one short enough to read on a line, and keep every
// source a pure read, so watching the overlay leaves the game as it is." Under
// this engine the panel itself is the build's too: it "draws the registered
// sources, it is hidden when the game starts, it is shown and hidden by the
// backtick key ... and it reads the game without changing it."
//
// THAT THE KEY TOGGLES IT IS `controls/overlay-backquote`'S POINT, NOT THIS ONE'S.
// This one is about the CONTENTS: a build that shows and hides a panel saying
// nothing loses here and keeps that one.
//
// HOW A FACT IS READ. The recorder hands back every operation one frame's render
// issued, so the panel's contents are the text that frame drew. The baseline is
// the same frame with the overlay away, subtracted run for run, so the HUD's own
// readouts — which `specs/ui.md` already puts the level, lives, score, timer and
// bays on — cancel out and what remains is the panel's own text. A fact is then
// looked for as a STANDALONE TOKEN in that text, so `13` is not found inside
// `130`. Nothing here asserts a layout, a label, an order or a format: a build
// may lay its panel out however it likes.
//
// THE POSED STRAIT IS BUILT SO EVERY FACT IS ITS OWN NUMBER. The level, the
// lives, the score, the timer, the critter's tile and center, the bear's tile,
// center and target, and the two counts are sixteen figures with no two alike,
// so a build that omits one of them fails on that one rather than passing on
// another fact's digits. That each of them landed where it was posed is asserted
// as a PRECONDITION before the panel is read, and the value the panel is then
// held to is the one the SNAPSHOT reports rather than the one this file posed:
// the requirement is that the overlay says what the game says. The two enum
// facts — the critter's facing `left` and the bear's facing `right` — are
// likewise different words, and the footing is posed `solid` rather than `floe`
// because `floe` is a word a floe COUNT is likely to be labelled with.
//
// THE TWO FACTS WITH NO DISTINGUISHING RENDERING ARE READ AS CHANGES INSTEAD. A
// swimming flag is a boolean and a bay is five of them, and a build is free to
// draw either as a word, a letter or a mark, so there is no token to look for.
// Each is therefore changed under a shown panel and the panel's text must change
// with it: the bear's step tile is uncovered by moving a floe off it, which
// leaves the floe COUNT alone, and one more bay is filled. That is a necessary
// condition rather than a sufficient one — a panel that redrew some unrelated
// changing value would satisfy it — which is why the fourteen facts above are
// read as values and only these two as changes.
//
// AND THE SNAPSHOT IS COMPARED ACROSS THE TOGGLE. `specs/instrumentation.md`
// makes every source a pure read, so every field the snapshot reports must be
// exactly as it was, `muted` included; `simTime` is left out of the comparison
// because delivering a key press takes a tick and that field "adds `TICK_DT` on
// every tick whatever the screen".

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertTrue,
} from "../assert";
import {
  tileCX,
  tileCY,
  tileLeft,
  type Facing,
  type FloeKind,
  type VehicleKind,
} from "../constants";
import {
  captureStill,
  createHarness,
  drawnText,
  poseBear,
  poseLane,
  requireBear,
  startCrossing,
  toggleOverlay,
  type FloeSnapshot,
  type Harness,
} from "../harness";

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

/** The text one frame drew, minus the text the same frame drew without a panel. */
function panelText(shown: readonly string[], hidden: readonly string[]): string[] {
  const rest = [...hidden];
  const own: string[] = [];
  for (const run of shown) {
    const at = rest.indexOf(run);
    if (at === -1) own.push(run);
    else rest.splice(at, 1);
  }
  return own;
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

afterEach(async () => {
  await h.dispose();
});

/**
 * Show the panel, read the text it added to the frame, and hide it again.
 *
 * The frame with the panel away is read first, so the subtraction is against the
 * very same picture rather than against one taken under a different state.
 */
async function readPanel(harness: Harness, still?: string): Promise<string[]> {
  const hidden = drawnText(await harness.frameCalls());
  await toggleOverlay(harness);
  const shown = drawnText(await harness.frameCalls());
  if (still !== undefined) await captureStill(harness, still);
  await toggleOverlay(harness);
  return panelText(shown, hidden);
}

it("draws the facts the specification lists and leaves the game as it was", async () => {
  await startCrossing(h, LEVEL);
  await h.debug.setLives(LIVES);
  await h.debug.setScore(SCORE);
  await h.debug.setTimer(TIMER);
  for (const bay of FILLED_BAYS) await h.debug.setBay(bay, true);

  await h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);
  await h.debug.setCritterFacing(CRITTER_FACING);

  await poseLane(h, VEHICLE_ROW, VEHICLE_KIND, VEHICLE_COLS);
  const [, cover] = await poseLane(h, FLOE_ROW, FLOE_KIND, FLOE_COLS);
  await poseLane(h, SPARE_FLOE_ROW, FLOE_KIND, SPARE_FLOE_COLS);

  // Every faculty off, so the bear holds the tile, the step and the target this
  // pose gives it for as long as the panel is read.
  const bear = await poseBear(h, BEAR_COL, BEAR_ROW, {
    sense: false,
    routing: false,
    travel: false,
    target: BEAR_TARGET,
  });
  await h.debug.setBearStep(bear, BEAR_STEP);

  const before = await h.snapshot();
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
  const after = await h.snapshot();

  assertGreaterThan(
    panel.length,
    0,
    "the runs of text the shown overlay drew over the frame the hidden one " +
      "drew — the overlay draws the registered sources " +
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
        `somewhere in the overlay — specs/instrumentation.md lists it among ` +
        `the facts the panel registers. What the panel drew: ` +
        `${JSON.stringify(panel)}`,
    );
  }

  // The overlay read the game and left it exactly as it was.
  assertDeepEqual(
    driftedFields(before, after),
    [],
    "the snapshot fields that moved across showing and hiding the overlay — " +
      "every source is a pure read (specs/instrumentation.md)",
  );

  // The two boolean facts, read as changes the panel must follow.
  await h.debug.setFloeX(cover, tileLeft(UNCOVER_COL));
  const swimming = await h.snapshot();
  assertTrue(
    requireBear(swimming, bear, "the bear over open water").swimming !==
      posedBear.swimming,
    `the bear's swimming flag after the floe covering its step tile was moved ` +
      `off it, against what it read before — this point cannot hold the panel ` +
      `to a fact the scenario never changed`,
  );
  assertGreaterThan(
    swimming.floes.length,
    0,
    "the floes still on the strait, of which the move changed none: the count " +
      "the panel reports is the same on both readings, so only the swimming " +
      "flag differs",
  );
  const swum = await readPanel(h);
  assertTrue(
    swum.join("\n") !== panel.join("\n"),
    `the overlay's text with the bear over open water, against its text with a ` +
      `floe under the tile it is travelling into — specs/instrumentation.md ` +
      `lists each bear's swimming flag among the facts the panel reports`,
  );

  await h.debug.setBay(EXTRA_BAY, true);
  const filled = await readPanel(h);
  assertTrue(
    filled.join("\n") !== swum.join("\n"),
    `the overlay's text with bay ${EXTRA_BAY} filled, against its text with ` +
      `that bay open — specs/instrumentation.md lists which bays are filled ` +
      `among the facts the panel reports`,
  );
});
