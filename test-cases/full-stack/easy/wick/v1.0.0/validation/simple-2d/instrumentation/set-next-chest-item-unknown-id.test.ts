// instrumentation/set-next-chest-item-unknown-id — setNextChestItem refuses an
// id that is no base weapon or passive, throws, and leaves the state exactly
// as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md ("Drawn outcomes",
// `setNextChestItem(id)`): "a base weapon id or a passive id; any other value
// is invalid". An evolved weapon's id and `LAMP_OIL_ID` are the nearest
// strings outside that domain.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import { LAMP_OIL_ID } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("throws on an evolved weapon's id and on lamp oil", async () => {
  const before = isolate(h, { keepTaper: true });

  for (const bad of ["pyre", LAMP_OIL_ID, "moth"]) {
    assertThrows(
      () => h.debug.setNextChestItem(bad),
      `setNextChestItem("${bad}")`,
    );
    assertDeepEqual(
      h.snapshot(),
      before,
      `the snapshot after setNextChestItem("${bad}") was refused`,
    );
  }

  await h.tick(1);
  captureStill(h, "refused");
});
