// hud/cargo-full-alert — the cargo reading changes when the bay fills.
//
// `specs/ui.md`: the cargo reading takes the alert treatment while the bay is
// full. Full is by SLOTS — `specs/mining.md` caps the bay by slot count and
// leaves weight to the jetpack — so the pose walks the last slot rather than the
// last kilogram, and the load is kept far below the lift limit so the overload
// reading, which is its own point, never appears.
//
// THE CONTROL IS WHAT MAKES THE TREATMENT SEPARABLE. Filling the last slot
// changes two things at once: the alert, and the count going up by one. So one
// more slot is added lower down the bay as a control, changing the same digit the
// same way, and the step that fills the bay must move materially more of the band
// than that.
//
// Every read is a frame of no length, so a pulsing treatment is held at one phase
// and a pose read twice comes back identical.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { CARGO_CAPACITY } from "../constants";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  stageCargo,
  standAtCamp,
  type Harness,
} from "../harness";
import { changed, sampleBar } from "./bar";

/** The ore the bay is filled with. Light, so a full bay is far under the lift. */
const ORE = "ferron" as const;

/** How many times the control the filling step must move. */
const TREATMENT_FACTOR = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the cargo reading differently once the bay is full", async () => {
  await openScene(h);
  await layCamp(h);
  await pinDrill(h);
  await standAtCamp(h);

  const cap = CARGO_CAPACITY[0];
  const at = async (count: number): Promise<number[]> => {
    await stageCargo(h, { [ORE]: count });
    return sampleBar(h);
  };

  const controlLow = await at(cap - 4);
  const controlHigh = await at(cap - 3);
  const nearlyFull = await at(cap - 1);
  const full = await at(cap);
  await captureStill(h, "full");

  const filled = await h.snapshot();
  const control = changed(controlLow, controlHigh);
  const filling = changed(nearlyFull, full);

  assertEqual(filled.cargo.slotsUsed, filled.cargo.slotCap, "specs/mining.md");
  assertEqual(filled.miner.overloaded, false, "specs/character.md");
  assertGreaterThan(filling, 0, "specs/ui.md");
  assertGreaterThan(filling, TREATMENT_FACTOR * control, "specs/ui.md");
});
