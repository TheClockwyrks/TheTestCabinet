// Refract — tracing/clear-only-on-playing: clear is read on the playing
// screen alone.
//
// specs/controls.md "Clearing": the clear action is read on the `playing`
// screen and does nothing on any other screen. The two screens a player
// actually sits on before play are the title and — in campaign — select, so
// KeyR is fired as a real tap on each, and the snapshot must come back
// identical apart from `simTime`, which the delivering frame necessarily
// accrues (specs/instrumentation.md: simTime accumulates every update,
// whatever the screen).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startCampaign,
  type Harness,
  type RefractSnapshot,
} from "../harness";

/** The snapshot with the one field a passing frame moves zeroed out. */
function settled(snapshot: RefractSnapshot): RefractSnapshot {
  return { ...snapshot, simTime: 0 };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("changes nothing when fired on the title and on the select screen", async () => {
  await resetTo(h);

  // On the title.
  const titleBefore = h.snapshot();
  assertEqual(titleBefore.screen, "title", "the tap is posed on the title");
  await h.tap("KeyR");
  const titleAfter = h.snapshot();
  assertDeepEqual(
    settled(titleAfter),
    settled(titleBefore),
    "the clear action fired on the title changes nothing: it is read on " +
      "the playing screen alone (specs/controls.md, Clearing)",
  );

  // On the select screen.
  await startCampaign(h);
  const selectBefore = h.snapshot();
  assertEqual(selectBefore.screen, "select", "the tap is posed on select");
  await h.tap("KeyR");
  captureStill(h, "unchanged");
  const selectAfter = h.snapshot();
  assertDeepEqual(
    settled(selectAfter),
    settled(selectBefore),
    "the clear action fired on the select screen changes nothing either",
  );
});
