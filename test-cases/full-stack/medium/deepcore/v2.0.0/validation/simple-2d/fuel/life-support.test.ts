// fuel/life-support — being underground burns life support.
//
// specs/character.md: fuel is spent by being underground, at `LIFE_SUPPORT_BURN`
// (`0.4`) fuel per second while the miner is below the surface ground line. It is
// charged whatever the miner is doing, so a long dig costs fuel even standing
// still, and walking and standing themselves cost nothing.
//
// The miner stands on a posed floor well below the ground line with nothing held
// and its drill gated, so the only drain the specification leaves running is the
// one under test. Ten seconds is run in a hundred and twenty frames rather than
// twelve hundred: `specs/instrumentation.md` has every rate integrated against
// the frame's delta, so the span reaches the same total either way.
//
// The miner's body is held still for the span. Travel is not what this point
// exercises, and holding it does two things the reading needs: it keeps the feet
// exactly on the ground line `specs/world.md` fixes, rather than a contact
// epsilon below it, and it lets the span run in a hundred and twenty frames.
// `specs/instrumentation.md` has every rate integrated against the frame's
// delta, so a coarse division reaches the same fuel — but a quarter-second frame
// is a quarter-second of gravity for a body that is free to move, and collision
// against a one-tile floor is not a rate.

import { afterEach, beforeEach, it } from "vitest";
import { LIFE_SUPPORT_BURN, SURFACE_Y } from "../constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  layFloor,
  minerFeet,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";

/** A column and a row well clear of the camp, the cave mouth, and the Core. */
const COL = 8;
const ROW = 12;

/** The span, and the frames it is divided into. */
const HOLD_SECONDS = 10;
const FRAMES = 120;

/** The spend, and the two frames of it a build may bill either side of the span. */
const EXPECTED = LIFE_SUPPORT_BURN * HOLD_SECONDS;
const TOLERANCE = (2 * EXPECTED) / FRAMES;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spends LIFE_SUPPORT_BURN a second while the miner is underground", async () => {
  openScene(h);
  layFloor(h, ROW);
  standOn(h, COL, ROW);
  pinDrill(h);
  pinMiner(h);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.miner.grounded, true, "specs/character.md");
  assertEqual(before.miner.state, "idle", "specs/character.md");
  assertBetween(minerFeet(before.miner), SURFACE_Y, Infinity, "specs/world.md");

  const after = await captureReplay(h, "underground", async () => {
    await h.advanceSeconds(HOLD_SECONDS, FRAMES);
    return h.snapshot();
  });

  assertBetween(
    before.miner.fuel - after.miner.fuel,
    EXPECTED - TOLERANCE,
    EXPECTED + TOLERANCE,
    "specs/character.md",
  );
});
