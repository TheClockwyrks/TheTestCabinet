// presentation/hud-torpedo-charge-is-drawn — the HUD carries a torpedo readout, and
// what it draws answers the charge. `warhead` only.
//
// THE RULE. `specs/ui.md`'s HUD table, under `warhead`: "Torpedo | A torpedo glyph
// with a charge bar beneath it, below the ships. The bar is full and the glyph lit
// while a torpedo is ready; while the charge is rising the glyph is dimmed and the
// bar fills smoothly from empty to full across the recharge." A ten-second recharge
// the player cannot see is a weapon they cannot plan around.
//
// WHAT IS DECIDED, AND WHAT IS DELIBERATELY NOT. `specs/overview.md` leaves the
// palette, the type and every drawn dimension to the build, so nothing here asserts
// where the readout is, how big it is or what colour it is drawn in. What is decided
// is that a readout EXISTS in the upper portion of the field clear of the star's
// drawn extent, and that it ANSWERS the charge: full, half and empty are three
// measurably different pictures, in that order.
//
// HOW IT IS FOUND, WITHOUT KNOWING WHERE THE BUILD PUT IT. `setTorpedoCharge` poses
// `1`, `0.5` and `0` in turn (`specs/instrumentation.md`), and the upper half of the
// field is read as a grid of square cells at each. The cells that carry different
// ink at a full charge from at an empty one ARE the readout: nothing else on the
// screen moved between the two frames, because the score, the ships, the screen and
// the ship's own position were all posed once and left alone. Their bounding set is
// where the readout is, and the readings below are taken over those cells alone.
//
// WHY THE READING IS INK RATHER THAN EXTENT. Each cell carries the FURTHEST any
// pixel in it fell from the field the build drew, so the sum over the readout is one
// number that rises both when a bar covers more cells and when the cells it already
// covered are painted brighter. That admits every honest bar: one drawn as a filled
// rectangle over a dim track, one drawn as fill alone with no track, and one whose
// glyph brightens between dimmed and lit — `specs/ui.md` asks for the last of those
// in as many words. A build whose readout is a fixed picture reads the same number
// three times and fails.
//
// AND THE ORDER IS ASSERTED, NOT MERELY THE DIFFERENCE. "The bar fills smoothly from
// empty to full" fixes which way the readout moves, so a build whose bar EMPTIES as
// the charge rises is caught here rather than passing on having drawn something that
// changed. Each of the two steps must carry at least {@link MIN_STEP} of the whole
// swing between empty and full, so a bar that jumps from empty straight to full at
// the last instant of the recharge — which is not "smoothly" — fails as well.
//
// THE SHIP IS PARKED OFF THE UPPER HALF, so the one body no scenario can remove is
// not read as part of the HUD, and the star's own drawn extent is excluded by
// {@link clearOfStar}.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { requireOp } from "../surface";
import {
  changedCells,
  inkAt,
  readInk,
  readPainted,
  type Cell,
  type InkGrid,
} from "./ink";
import { HUD_REGION, SHIP_SPOT, clearOfStar, sampleField } from "./scene";

/** The charges posed, in the order they are read: full, half, empty. */
const CHARGES = [1, 0.5, 0] as const;

/**
 * One cell of the reading, in logical units.
 *
 * One unit, the same square unit `hud-lives-are-drawn` reads the HUD in. A charge
 * bar drawn at any size a HUD would use spans many of these.
 */
const CELL = 1;

/** How much a cell's ink must move between two charges to be the readout's, of 441. */
const CHANGE = 30;

/**
 * How much of the whole swing each of the two steps must carry.
 *
 * A tenth, and it is set to refuse ONE thing: a readout that does nothing at all
 * over one half of the recharge, which is what "fills smoothly from empty to full"
 * rules out. A build whose bar jumps from empty straight to full at the last instant
 * reads `0` for the half it did nothing in and fails at any positive figure.
 *
 * It is deliberately not tighter, because how the swing divides between the bar and
 * the glyph is the build's own and the specification fixes neither. A bar that fills
 * evenly puts half the swing into each step; a build whose glyph is large and only
 * lights at a full charge puts most of it into the first. The three references read
 * `0.25`, `0.34` and `0.44` for their smaller step, so a tenth clears every one of
 * them by more than double and still leaves a static half of the recharge nowhere to
 * hide.
 */
const MIN_STEP = 0.1;

/** The score and the ships posed, so the HUD's other readouts are drawn throughout. */
const SCORE = 730;
const LIVES = 3;

/** The ink a set of cells carries in one grid: the sum of their readings. */
function inkOver(grid: InkGrid, cells: readonly Cell[]): number {
  let total = 0;
  for (const cell of cells) total += inkAt(grid, cell.col, cell.row);
  return total;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a torpedo readout whose ink falls from a full charge to an empty one", async () => {
  startPlaying(h);
  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);
  // Off the upper half entirely, so the ship on the field is not read as the HUD.
  h.debug.setShipPosition(SHIP_SPOT.x, SHIP_SPOT.y);
  h.debug.setShipVelocity(0, 0);
  await h.advance(1);
  const field = sampleField(readPainted(h));

  const setCharge = requireOp(h.debug, "setTorpedoCharge");
  const grids: InkGrid[] = [];
  for (const charge of CHARGES) {
    setCharge(charge);
    await h.advance(1);
    grids.push(readInk(readPainted(h), HUD_REGION, CELL, field));
    // Overwritten each time round, so the picture kept is the last charge posed.
    captureStill(h, "charge");
  }

  const full = grids[0];
  const empty = grids[grids.length - 1];
  const readout = changedCells(empty, full, CHANGE, clearOfStar);
  if (readout.length === 0) {
    fail(
      "a torpedo readout in the upper portion of the field, clear of the " +
        "star, drawn differently at a full charge from at an empty one — a " +
        "glyph with a charge bar beneath it, the bar full and the glyph lit " +
        "when a torpedo is ready (specs/ui.md)",
      "nothing in the upper portion of the field was drawn differently at " +
        "torpedoCharge 1 from at 0",
    );
  }

  const ink = grids.map((grid) => inkOver(grid, readout));
  const swing = ink[0] - ink[ink.length - 1];
  assertGreaterThan(
    swing,
    0,
    "the ink the torpedo readout carries at a full charge less the ink it " +
      `carries at an empty one, over the ${String(readout.length)} square ` +
      "units the two frames differ in — the bar is full and the glyph lit " +
      "when a torpedo is ready, and the bar fills from empty across the " +
      "recharge (specs/ui.md)",
  );

  for (let step = 0; step + 1 < ink.length; step += 1) {
    assertGreaterThanOrEqual(
      (ink[step] - ink[step + 1]) / swing,
      MIN_STEP,
      "how much of the whole full-to-empty swing the readout gave up between " +
        `torpedoCharge ${String(CHARGES[step])} and ` +
        `${String(CHARGES[step + 1])}, where the bar fills smoothly from ` +
        "empty to full across the recharge (specs/ui.md)",
    );
  }
});
