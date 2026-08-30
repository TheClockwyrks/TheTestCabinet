// Deepcore — supplies/using-with-nothing-to-change-is-a-no-op: a supply with
// nothing to do is not spent.
//
// `specs/items.md`: "Using an item held zero of, or one that would change
// nothing, is a no-op: a note is shown and nothing is consumed." The two supplies
// that can have nothing to do are the two that fill a bar to a maximum, so the
// scene is a full hull and a full tank with both of them held.
//
// Each is used and the counts are read back unchanged. The hull and the tank are
// read too, because a build that spent the supply and clamped the bar at its
// maximum would leave the bars looking right and the pocket a supply lighter,
// which is exactly what the specification says must not happen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  stageItems,
  standAtCamp,
  type Harness,
} from "../harness";
import { openCampScene } from "./blast-scene";

/** Held so a consumption would be unmistakable. */
const HELD = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("consumes nothing when the supply would change nothing", async () => {
  await openCampScene(h);
  await standAtCamp(h);
  await stageItems(h, { nanobots: HELD, "emergency-fuel": HELD });

  const { miner } = await h.snapshot();
  await h.debug.setHull(miner.maxHull);
  await h.debug.setFuel(miner.maxFuel);

  await h.debug.useItem("nanobots");
  await h.debug.useItem("emergency-fuel");
  const after = await h.snapshot();

  await h.advance(2);
  await captureStill(h, "noop");

  assertEqual(
    after.items.nanobots,
    HELD,
    "nanobots held after using one at a full hull",
  );
  assertEqual(
    after.items["emergency-fuel"],
    HELD,
    "emergency fuel held after using one at a full tank",
  );
  assertEqual(after.miner.hull, miner.maxHull, "hull after the refused repair");
  assertEqual(
    after.miner.fuel,
    miner.maxFuel,
    "the tank after the refused top-up",
  );
});
