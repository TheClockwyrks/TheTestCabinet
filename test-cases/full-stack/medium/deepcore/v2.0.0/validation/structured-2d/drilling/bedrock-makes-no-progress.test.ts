// drilling/bedrock-makes-no-progress — the bedrock border cannot be drilled.
//
// specs/character.md: a drill aimed into the bedrock border starts no cut and
// makes no progress. specs/world.md puts that border in columns `0` and `31`, so
// the playable field cannot be dug out of sideways.
//
// The miner walks east along a floor until it is flush against column `31` and
// holds the direction there for four seconds — thirty-two `DRILL_HIT_INTERVAL`s,
// twice what the deepest band takes to break at the weakest drill. The border
// cell it is aimed at is the one beside its box, not the one under its feet.

import { afterEach, beforeEach, it } from "vitest";
import { MINER_W, PLAYABLE_COL_MAX, TILE, WORLD_COLS } from "../constants";
import { assertBetween, assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  standOn,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The row the miner walks along, well clear of the camp and the Core. */
const ROW = 12;

/** The border column the drill is aimed into: the east edge of the grid. */
const BORDER_COL = WORLD_COLS - 1;

/** How long the drill is held into the border, in frames. */
const HOLD_FRAMES = 4 * TICK_HZ;

/**
 * How far the box may sit from the border's face, in world units.
 *
 * A build resolves a wall contact with an epsilon of its own and
 * `specs/character.md` fixes none, so a unit of the eighty a tile spans is the
 * room the reading allows.
 */
const FLUSH = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the bedrock border whole however long the drill is held", async () => {
  openScene(h);
  layFloor(h, ROW);
  standOn(h, PLAYABLE_COL_MAX, ROW, "east");

  const opening = h.tileAt(BORDER_COL, ROW - 1);
  assertEqual(opening.kind, "bedrock", "specs/world.md");
  assertEqual(opening.health, null, "specs/instrumentation.md");

  const held = await captureReplay(h, "border", async () => {
    h.hold(ACTION_KEY.right);
    try {
      await h.advance(HOLD_FRAMES);
      return h.snapshot();
    } finally {
      h.release(ACTION_KEY.right);
    }
  });

  // Flush against the border, so the drill was aimed into it for the hold.
  assertBetween(
    held.miner.x + MINER_W,
    BORDER_COL * TILE - FLUSH,
    BORDER_COL * TILE,
    "specs/character.md",
  );

  const after = h.tileAt(BORDER_COL, ROW - 1);
  assertEqual(after.kind, "bedrock", "specs/character.md");
  assertEqual(after.health, null, "specs/character.md");
  assertEqual(held.miner.drilling, null, "specs/character.md");
});
