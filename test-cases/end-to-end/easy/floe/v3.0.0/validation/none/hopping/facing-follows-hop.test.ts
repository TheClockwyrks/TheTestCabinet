// hopping/facing-follows-hop — the critter faces the way it last hopped.
//
// `specs/hopping.md` gives an accepted hop four consequences, and this decides one
// of them: it "sets the critter's facing to the direction hopped". The facing is
// what `specs/assets.md` draws the crosser from, so a build that never turns the
// critter, or that turns it the wrong way, leaves a player facing the near shore
// for the whole crossing.
//
// ALL FOUR DIRECTIONS ARE HOPPED, IN TURN, AND READ AFTER EACH. One direction
// would pass a build that hard-codes a single facing, and reading only the last
// would pass a build that turns on some hops and not others. Read after every hop,
// the reading names which hop the build failed to turn on.
//
// NO READING REPEATS THE FACING THAT PRECEDED IT, which is what stops a build
// that simply keeps whatever facing it had from coasting through one of the four.
// `specs/hopping.md` says a fresh critter faces `up`, and the sequence opens with
// a hop UP, so the critter is first posed facing `down` — the pose is the only way
// to make the first reading decide anything, and it changes nothing else about
// the critter.
//
// THE REST BETWEEN HOPS IS FOUR TIMES THE COOLDOWN, not the cooldown itself, and
// each hop is a fresh press rather than a held key. The cadence is graded by
// `cooldown-blocks`, `cooldown-releases` and `held-repeats`; a build whose
// cooldown is too long, or which does not auto-repeat a held direction, should
// lose those points and not this one, so the drive here waits long enough that
// any such build still takes all four hops.
//
// The hops run around one square of an emptied ice band (`specs/strait.md`),
// where every tile is plain solid ice and every hop is accepted, and each is a
// real press, so what is read is the game's own hop rather than a posed facing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOP_COOLDOWN, HOP_KEY, START_COL, type Facing } from "../constants";
import {
  captureReplay,
  createHarness,
  critterTile,
  sameTile,
  startCrossing,
  ticksPast,
  type Harness,
} from "../harness";

/** A row of the ice band, with a clear row above and below it. */
const ROW = 15;

/** The facing the critter is posed with, so the first hop's reading is a change. */
const POSED_FACING: Facing = "down";

/** The four hops, in turn. */
const SEQUENCE: readonly Facing[] = ["up", "down", "left", "right"];

/** The ticks left between one hop and the next press: four cooldowns' worth. */
const REST_TICKS = ticksPast(HOP_COOLDOWN * 4);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("reports the direction of each hop as the critter's facing", async () => {
  await startCrossing(harness);
  await harness.debug.addCritter(START_COL, ROW);
  await harness.debug.setCritterFacing(POSED_FACING);

  const facings = await captureReplay(harness, "facing", async () => {
    const seen: Facing[] = [];
    for (const direction of SEQUENCE) {
      const before = critterTile(await harness.snapshot());
      await harness.advance(REST_TICKS);
      await harness.tap(HOP_KEY[direction]);
      const after = await harness.snapshot();
      assertEqual(
        sameTile(critterTile(after), before),
        false,
        `the hop ${direction} to be taken`,
      );
      seen.push(after.critter.facing);
    }
    return seen;
  });

  for (const [index, direction] of SEQUENCE.entries()) {
    assertEqual(
      facings[index],
      direction,
      `the facing after hop ${index + 1}, taken ${direction}`,
    );
  }
});
