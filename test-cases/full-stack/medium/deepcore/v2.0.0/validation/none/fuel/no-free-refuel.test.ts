// fuel/no-free-refuel — fuel never refills on its own.
//
// specs/character.md: fuel "is replenished only by paying for it at the Fuel
// Depot", and "fuel never refills on its own, on the surface or anywhere else".
// specs/gameplay.md says the same from the other side: arriving at the surface
// refuels and repairs nothing, and the surface is where they are bought back.
//
// So the tank is posed part empty and the miner left standing in the camp — the
// one place a build might be tempted to top it up — for thirty seconds. The
// reading is that the tank did not RISE and is still short of its maximum: the
// sibling check owns the other direction, that standing up here does not drain
// it either.
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
import { assertEqual, assertLessThan } from "../assert";
import { FUEL_TANK_MAX } from "../constants";
import {
  captureReplay,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  pinMiner,
  standAtCamp,
  type Harness,
} from "../harness";

/** What the climb is posed as having left in the tank. */
const LEFT = 40;

/** The span, and the frames it is divided into. */
const HOLD_SECONDS = 30;
const FRAMES = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the tank exactly as the climb left it, however long the wait", async () => {
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);
  await pinDrill(h);
  await pinMiner(h);
  await h.debug.setFuel(LEFT);
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(before.miner.fuel, LEFT, "specs/instrumentation.md");
  assertEqual(before.miner.maxFuel, FUEL_TANK_MAX[0], "specs/upgrades.md");
  assertEqual(before.credits, 0, "specs/gameplay.md");

  const after = await captureReplay(h, "tank", async () => {
    await h.advanceSeconds(HOLD_SECONDS, FRAMES);
    return await h.snapshot();
  });

  assertEqual(after.miner.fuel, LEFT, "specs/character.md");
  assertLessThan(after.miner.fuel, after.miner.maxFuel, "specs/character.md");
  // And nothing was bought, so the tank standing where it stands is the absence
  // of a refill rather than one paid for out of the balance.
  assertEqual(after.credits, 0, "specs/gameplay.md");
});
