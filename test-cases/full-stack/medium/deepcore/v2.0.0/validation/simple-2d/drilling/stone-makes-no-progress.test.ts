// drilling/stone-makes-no-progress — unbreakable stone cannot be drilled.
//
// specs/character.md: a drill aimed into unbreakable stone starts no cut and
// makes no progress. specs/world.md has that stone sit inside the playable field
// rather than at its border, so a vertical shaft that meets one has to jog
// sideways past it, and specs/items.md makes the explosives the only way through.
//
// The hold runs for four seconds: thirty-two `DRILL_HIT_INTERVAL`s, and twice
// what the deepest band takes to break at the weakest drill. Three readings, all
// of them the specification's own words: the cell is still stone, no cut was
// started, and the miner did not sink — a down cut over a minable cell carries
// the miner down through it, so a miner that has not moved is a cut that made no
// progress.

import { afterEach, beforeEach, it } from "vitest";
import { TILE } from "../constants";
import { assertBetween, assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  minerFeet,
  openScene,
  standOn,
  TICK_HZ,
  type Harness,
} from "../harness";

/** A column and a row well clear of the camp, the cave mouth, and the Core. */
const COL = 8;
const ROW = 12;

/** How long the drill is held into the boulder, in frames. */
const HOLD_FRAMES = 4 * TICK_HZ;

/**
 * How far the feet may sit from the cell top, in world units.
 *
 * A build resolves a resting contact with an epsilon of its own and
 * `specs/character.md` fixes none, so a unit of the eighty a tile spans is the
 * room the reading allows. One hit of the weakest drill on the shallowest band
 * would have carried the miner a quarter of a tile down.
 */
const RESTING = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a boulder whole however long the drill is held into it", async () => {
  openScene(h);
  h.debug.setTile(COL, ROW, "stone");
  standOn(h, COL, ROW);

  const opening = h.tileAt(COL, ROW);
  assertEqual(opening.kind, "stone", "specs/instrumentation.md");
  assertEqual(opening.health, null, "specs/instrumentation.md");

  const held = await captureReplay(h, "boulder", async () => {
    h.hold(ACTION_KEY.down);
    try {
      await h.advance(HOLD_FRAMES);
      return h.snapshot();
    } finally {
      h.release(ACTION_KEY.down);
    }
  });

  const after = h.tileAt(COL, ROW);
  assertEqual(after.kind, "stone", "specs/character.md");
  assertEqual(held.miner.drilling, null, "specs/character.md");
  assertBetween(
    minerFeet(held.miner),
    ROW * TILE - RESTING,
    ROW * TILE + RESTING,
    "specs/character.md",
  );
});
