// hopping/facing-follows-hop — the critter faces the way it last hopped.
//
// specs/hopping.md gives an accepted hop four consequences, and this decides one of
// them: it "sets the critter's facing to the direction hopped". The facing is what
// specs/assets.md draws the crosser from, so a build that never turns the critter,
// or that turns it the wrong way, leaves a player facing the near shore for the
// whole crossing.
//
// ALL FOUR DIRECTIONS ARE HOPPED, IN TURN, AND READ AFTER EACH. One direction would
// pass a build that hard-codes a single facing, and reading only the last would
// pass a build that turns on some hops and not others. Read after every hop, the
// reading names which hop the build failed to turn on.
//
// NO READING REPEATS THE FACING THAT PRECEDED IT, which is what stops a build that
// simply keeps whatever facing it had from coasting through one of the four.
// specs/hopping.md says a fresh critter faces `up`, and the sequence opens with a
// hop UP, so the critter is first posed facing `down` — the pose is the only way to
// make the first reading decide anything, and it changes nothing else about the
// critter.
//
// THE REST BETWEEN HOPS IS FOUR TIMES THE COOLDOWN, not the cooldown itself, and
// each hop is a fresh press rather than a held key. The cadence is graded by
// `cooldown-blocks`, `cooldown-releases` and `held-repeats`; a build whose cooldown
// is too long, or which does not auto-repeat a held direction, should lose those
// points and not this one, so the drive here waits long enough that any such build
// still takes all four hops.
//
// THE HOPS RUN AROUND ONE SQUARE OF AN EMPTIED ICE BAND (specs/strait.md), where
// every tile is plain solid ice, every one of the four targets is inside the grid,
// and no vehicle is left to refuse anything — so every hop of the sequence is
// accepted and the reading is the facing rather than a refusal. Each hop is a REAL
// press, so what is read is the game's own hop rather than a posed facing, and the
// tile is checked to have moved before the facing is read: a facing that changed
// without a hop is not the consequence this point decides.
//
// THE PRESS IS DOWN, ONE WHOLE TICK, UP. specs/controls.md reads the four movement
// actions as HELD on the `playing` screen, so a key genuinely down while a tick
// runs is the one press a held reading and a press-edge reading both see, and
// exactly once: `HOP_COOLDOWN` is `14.4` ticks, so no second hop can follow inside
// that tick.

import { afterEach, beforeEach, it } from "vitest";
import { HOP_COOLDOWN, START_COL } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  critterTile,
  holdFor,
  keyFor,
  sameTile,
  startCrossing,
  ticksFor,
  type Facing,
  type Harness,
} from "../harness";

/** A row of the ice band, with a clear row above and below it. */
const ROW = 15;

/** The facing the critter is posed with, so the first hop's reading is a change. */
const POSED_FACING: Facing = "down";

/** The four hops, in turn: a square, so the sequence ends where it began. */
const SEQUENCE: readonly Facing[] = ["up", "down", "left", "right"];

/**
 * The ticks left between one hop and the next press: four cooldowns' worth.
 *
 * `HOP_COOLDOWN` is `0.12` s (specs/hopping.md), and four of it is far past any
 * rounding of the `14.4` ticks it spans, so a build whose cadence is a tick either
 * way still takes all four hops and is graded here on the facing alone.
 */
const REST_TICKS = ticksFor(HOP_COOLDOWN * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the direction of each hop as the critter's facing", async () => {
  startCrossing(h);
  h.debug.addCritter(START_COL, ROW);
  h.debug.setCritterFacing(POSED_FACING);

  const posed = h.snapshot().critter;
  assertEqual(posed.col, START_COL, "the pose put the critter on the ice band");
  assertEqual(posed.row, ROW, "the pose put the critter on row 15");
  assertEqual(
    posed.facing,
    POSED_FACING,
    "the posed facing, so the first hop's reading is a change and not a default",
  );

  const facings = await captureReplay(h, "facing", async () => {
    const seen: Facing[] = [];
    for (const direction of SEQUENCE) {
      const before = critterTile(h.snapshot());
      await h.advance(REST_TICKS);
      await holdFor(h, keyFor(direction), 1);
      const after = h.snapshot();
      assertEqual(
        sameTile(critterTile(after), before),
        false,
        `the hop ${direction} to be taken, so the facing read is a hop's`,
      );
      seen.push(after.critter.facing);
    }
    return seen;
  });

  for (const [index, direction] of SEQUENCE.entries()) {
    assertEqual(
      facings[index],
      direction,
      `the facing after hop ${index + 1}, taken ${direction} (specs/hopping.md)`,
    );
  }
});
