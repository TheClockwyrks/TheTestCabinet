// Wick — instrumentation/set-next-chest-item-unknown-id: setNextChestItem
// refuses an id that is no base weapon or passive, throws, and leaves the
// state exactly as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes", `setNextChestItem(id)`): "a base weapon id or a passive id; any
// other value is invalid". An evolved weapon's id and `LAMP_OIL_ID` are the
// nearest strings outside that domain.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertRejects } from "../assert";
import { LAMP_OIL_ID } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  posedState,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on an evolved weapon's id and on lamp oil", async () => {
  const before = await isolate(h, { taper: true });

  for (const bad of ["pyre", LAMP_OIL_ID, "moth"]) {
    await assertRejects(
      () => h.debug.setNextChestItem(bad),
      `setNextChestItem("${bad}")`,
    );
    assertDeepEqual(
      posedState(await h.snapshot()),
      posedState(before),
      `the state across the refused setNextChestItem("${bad}")`,
    );
  }

  await captureStill(h, "refused");
});
