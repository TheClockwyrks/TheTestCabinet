// fuel/out-of-fuel-at-the-surface-is-safe — an empty tank in the camp is not a death.
//
// specs/character.md makes the death conditional on where the miner is: fuel
// reaching `0` "while the miner is below the surface ground line" strands it,
// because there is no way up. At or above that line there is nothing to be
// stranded from — the miner stands in the camp, walks to the Fuel Depot, and the
// expedition carries on.
//
// So the tank is posed empty with the miner on the camp ground and the game is
// left to run for twenty seconds. The reading is that nothing ended: the screen
// is still `in-mine` and the expedition has accumulated no summary. Twenty
// seconds is far longer than the fraction of a second the underground death takes
// from a full stop.
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
import { assertEqual } from "../assert";
import { SURFACE_Y } from "../constants";
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
const HOLD_SECONDS = 20;
const FRAMES = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries on with an empty tank while the miner stands in the camp", async () => {
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);
  await pinDrill(h);
  await pinMiner(h);
  await h.debug.setFuel(0);
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(before.miner.fuel, 0, "specs/instrumentation.md");
  assertEqual(minerFeet(before.miner), SURFACE_Y, "specs/world.md");
  assertEqual(before.screen, "in-mine", "specs/ui.md");

  const after = await captureReplay(h, "dry", async () => {
    await h.advanceSeconds(HOLD_SECONDS, FRAMES);
    return await h.snapshot();
  });

  assertEqual(after.screen, "in-mine", "specs/character.md");
  assertEqual(after.summary, null, "specs/gameplay.md");
  assertEqual(after.miner.fuel, 0, "specs/character.md");
  assertEqual(after.miner.grounded, true, "specs/character.md");
});
