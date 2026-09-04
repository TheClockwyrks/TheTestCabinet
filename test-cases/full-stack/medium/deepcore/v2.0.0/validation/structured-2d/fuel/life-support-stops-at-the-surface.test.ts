// fuel/life-support-stops-at-the-surface — the camp costs nothing.
//
// specs/character.md: the life-support drain is charged "while below the surface
// ground line" and nowhere else, and walking and standing still cost no fuel. So
// a miner standing in the camp with nothing held spends nothing at all, however
// long it stands there.
//
// The scene is the camp as generation leaves it — `row 1` solid across the
// playable width with the cave mouth still open — so the miner rests on the camp
// ground rather than falling through an emptied mine. Thirty seconds is run in a
// hundred and twenty frames: `specs/instrumentation.md` has every rate integrated
// against the frame's delta, so the span reaches the same total either way, and a
// build charging even a tenth of `LIFE_SUPPORT_BURN` up here loses three fuel.
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
import { SURFACE_Y } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  layCamp,
  minerFeet,
  openScene,
  pinDrill,
  pinMiner,
  standAtCamp,
  type Harness,
} from "../harness";

/** The span, and the frames it is divided into. */
const HOLD_SECONDS = 30;
const FRAMES = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spends no fuel at all while the miner stands in the camp", async () => {
  openScene(h);
  layCamp(h);
  standAtCamp(h);
  pinDrill(h);
  pinMiner(h);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.miner.grounded, true, "specs/world.md");
  assertEqual(minerFeet(before.miner), SURFACE_Y, "specs/world.md");
  assertEqual(before.depthMeters, 0, "specs/world.md");

  const after = await captureReplay(h, "camp", async () => {
    await h.advanceSeconds(HOLD_SECONDS, FRAMES);
    return h.snapshot();
  });

  assertEqual(after.miner.fuel, before.miner.fuel, "specs/character.md");
});
