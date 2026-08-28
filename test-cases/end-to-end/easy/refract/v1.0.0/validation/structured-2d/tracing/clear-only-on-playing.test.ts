// Refract — tracing/clear-only-on-playing: clear is read on the playing
// screen alone.
//
// specs/controls.md "Clearing": the clear action is read on the `playing`
// screen and does nothing on any other. So KeyR — the action's specified
// binding — fired on the title and on the select screen changes nothing.
//
// "Changes nothing" is read off the snapshot whole, with one field excused:
// `simTime` accumulates on the frame that delivers the key's edge, because
// time passing is not an effect of the action. Everything else — screen,
// mode, menu and select highlights, progress, board, beams, trace, pointer,
// muted — must be identical.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startCampaign,
  type Harness,
} from "../harness";
import type { RefractSnapshot } from "../surface";

/** The snapshot with the one legitimately time-driven field neutralized. */
function timeless(snapshot: RefractSnapshot): RefractSnapshot {
  return { ...snapshot, simTime: 0 };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("KeyR on the title and on the select screen changes nothing", async () => {
  // On the title.
  await resetTo(h, 1);
  const titleBefore = h.snapshot();
  assertEqual(titleBefore.screen, "title", "the pose opens on the title");

  await h.tap("KeyR");

  const titleAfter = h.snapshot();
  assertDeepEqual(
    timeless(titleAfter),
    timeless(titleBefore),
    "the clear action fired on the title changes nothing",
  );

  // On the select screen, entered the way a player enters it.
  await startCampaign(h, 1);
  const selectBefore = h.snapshot();
  assertEqual(selectBefore.screen, "select", "the pose lands on select");

  await h.tap("KeyR");

  const selectAfter = h.snapshot();
  assertDeepEqual(
    timeless(selectAfter),
    timeless(selectBefore),
    "the clear action fired on select changes nothing",
  );

  // Evidence: the select screen unchanged by the clear action.
  captureStill(h, "unchanged");
});
