// Deepcore — supplies/nanobots-repair: nanobots mend a fixed amount, and never
// more than the tank holds.
//
// `specs/items.md`: Regenerative Nanobots "Repairs `NANOBOT_HULL` (`20`) hull,
// capped at the maximum." Two uses decide the one requirement in one direction:
// one from a hull far enough below the maximum for the whole repair to fit, which
// must add exactly `NANOBOT_HULL`, and one from a hull within `NANOBOT_HULL` of
// the maximum, which must stop at the maximum rather than overfilling.
//
// The scene is the camp, above the ground line, and each reading is taken on the
// call itself. `specs/character.md` gives hull no drain of its own and no
// regeneration, so nothing else here can move the number either way.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { NANOBOT_HULL } from "../constants";
import {
  captureStill,
  createHarness,
  standAtCamp,
  type Harness,
} from "../harness";
import { openCampScene } from "./blast-scene";

/** Comfortably more than `NANOBOT_HULL` short of the maximum. */
const DEEP_DAMAGE = 3 * NANOBOT_HULL;

/** Inside `NANOBOT_HULL` of the maximum, so the repair has to be capped. */
const LIGHT_DAMAGE = NANOBOT_HULL / 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("repairs NANOBOT_HULL and stops at the maximum", async () => {
  await openCampScene(h);
  await standAtCamp(h);
  await h.debug.setItemCount("nanobots", 2);

  const { miner } = await h.snapshot();
  const maxHull = miner.maxHull;

  await h.debug.setHull(maxHull - DEEP_DAMAGE);
  await h.debug.useItem("nanobots");
  const repaired = await h.snapshot();

  await h.debug.setHull(maxHull - LIGHT_DAMAGE);
  await h.debug.useItem("nanobots");
  const capped = await h.snapshot();

  await h.advance(2);
  await captureStill(h, "repair");

  assertEqual(
    repaired.miner.hull,
    maxHull - DEEP_DAMAGE + NANOBOT_HULL,
    "hull after a repair with room for the whole of it",
  );
  assertEqual(
    capped.miner.hull,
    maxHull,
    "hull after a repair inside NANOBOT_HULL of the maximum",
  );
});
