// cursor/bolt-stops-at-foe — a bolt is consumed by the FIRST foe in its column
// and never reaches what stands above it.
//
// specs/cursor.md: a climbing bolt "resolves against the first thing its center
// reaches", a foe among them, reached when "the bolt's center is inside the
// foe's box, `FOE_HALF` (`12`) units from the foe's center on each axis", and "a
// bolt resolves against exactly one thing and is removed from flight in the same
// update". specs/foes.md fixes the glitch at one bolt to destroy.
//
// THE NODE FURTHER UP IS POSED AT CHARGE 2, NOT INERT, SO EVERY WRONG MODEL
// READS AS A DIFFERENT NUMBER. Untouched it reads 2; a bolt that flew past the
// glitch and struck it leaves 1 (specs/nodes.md); a bolt that clears what it
// passes leaves the tile empty.
//
// THE GLITCH IS POSED INERT AND STILL. Its travel is held off so it keeps the
// column the shot goes up, and its mind is held off so nothing it does to the
// field enters the reading: the requirement is what the bolt does to it, and a
// glitch that darted out of the column or ate its way across the board would put
// `foes`'s requirements into this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertUndefined } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  foeById,
  poseBoltAtTile,
  poseFoe,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The column the shot goes up. */
const COLUMN = 20;

/** The row the glitch stands on. */
const FOE_ROW = 10;

/**
 * The node further up the same column, and the charge it is posed at: 2, the
 * value that tells a bolt that passed through from one that cleared the tile.
 */
const WITNESS_ROW = 5;
const WITNESS_CHARGE = 2;

/** The row the bolt starts on, below both. */
const START_ROW = 14;

/**
 * How long the sweep waits for the bolt to leave flight, in frames: two
 * seconds, for the reason `cursor/bolt-stops-at-node` states.
 */
const SWEEP_TICKS = ticksFor(2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("kills the glitch and leaves the node above it standing", async () => {
  startPlaying(h);
  h.debug.setNode(COLUMN, WITNESS_ROW, WITNESS_CHARGE);
  const glitch = poseFoe(h, "glitch", COLUMN, FOE_ROW);
  h.debug.setFoeTravel(glitch, false);
  h.debug.setFoeMind(glitch, false);
  poseBoltAtTile(h, COLUMN, START_ROW);

  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: SWEEP_TICKS,
  });
  captureStill(h, "consumed");

  assertEqual(swept.hit, true, "the bolt leaves flight");
  assertUndefined(
    foeById(swept.snapshot, glitch),
    "the glitch the bolt reached is destroyed",
  );
  assertLength(swept.snapshot.foes, 0, "no foe is left on the board");
  assertEqual(
    chargeAt(swept.snapshot, COLUMN, WITNESS_ROW),
    WITNESS_CHARGE,
    `the node on (${COLUMN}, ${WITNESS_ROW}) is untouched`,
  );
});
