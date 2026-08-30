// controls/key-targeting — `KeyT` cycles the selected firing structure's priority.
//
// THE REQUIREMENT. `specs/controls.md` binds `targeting` to `KeyT` and fixes the
// cycle exactly: "Cycling targeting steps the selected firing structure's priority
// through `first`, `last`, `nearest`, `strongest`, `weakest`, and back to `first`,
// one step per activation." Five priorities, so six presses return the structure
// to where it started.
//
// HOW IT IS DECIDED. One firing component is the only thing on an otherwise empty
// yard and is selected. Whatever priority it stands at is read first and the cycle
// is measured FROM there rather than from an assumed starting value, because which
// priority a fresh component starts on is the components checklist's point and not
// this one. `KeyT` is then pressed six times, as a player presses it — real
// browser key events through the build's own keyboard layer — and the priority is
// read after each: one step of the stated order per press, and back to the start
// on the sixth.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { TARGETING_PRIORITIES, keyFor } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
  structureById,
  targetingAfter,
  type Harness,
} from "../harness";

/** Where the component stands: clear of the chain and of the yard edges. */
const ANCHOR = { col: 10, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("steps the priority one place per press and returns to the start", async () => {
  await openYard(h);
  const id = await standComponent(h, "capacitor", 3, ANCHOR.col, ANCHOR.row);
  await h.debug.select(id);

  const start = structureById(await h.snapshot(), id).targeting;
  assertNotNull(
    start,
    "a firing structure to report a targeting priority " +
      "(specs/instrumentation.md)",
  );

  for (let press = 1; press <= TARGETING_PRIORITIES.length + 1; press += 1) {
    await h.tap(keyFor("targeting"));
    if (press === 1) await captureStill(h, "cycle");

    assertEqual(
      structureById(await h.snapshot(), id).targeting,
      targetingAfter(start!, press),
      `the priority after ${press} press${press === 1 ? "" : "es"} of ` +
        `${keyFor("targeting")}, stepping through first, last, nearest, ` +
        "strongest, weakest and back to first (specs/controls.md)",
    );
  }
});
