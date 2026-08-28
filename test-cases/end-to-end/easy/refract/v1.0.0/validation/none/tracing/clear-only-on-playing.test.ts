// Refract — tracing/clear-only-on-playing: clear is read on the playing screen
// alone.
//
// `specs/controls.md` "Clearing": the `clear` action "is read on the `playing`
// screen and does nothing on any other screen". The two screens a player
// actually passes on the way to a board are the title and the campaign's
// select grid, so `KeyR` — the action's fixed binding — is fired on each, and
// the game-facing state must not move: the screen, the highlighted item, the
// mode, the progression, the board, the beams. `simTime` and the mirrored
// pointer are deliberately outside the comparison — delivering a key press
// runs a frame, and both fields move on every frame by specification
// (`specs/instrumentation.md`), whatever the key did.
//
// The select screen is reached through `startMode`, the pose defined to act
// "exactly as choosing its menu item does", so nothing here hangs on the
// build's own menu bindings.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAction,
  startCampaign,
  type Harness,
} from "../harness";
import { gameFields } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes nothing on the title or the select screen", async () => {
  // On the title: a fresh harness arrives reset to the title screen.
  const titleBefore = await h.snapshot();
  assertEqual(titleBefore.screen, "title", "a reset build opens on the title");
  await fireAction(h, "clear");
  const titleAfter = await h.snapshot();
  assertDeepEqual(
    gameFields(titleAfter),
    gameFields(titleBefore),
    "the clear action fired on the title changes nothing",
  );

  // On the campaign's select screen.
  await startCampaign(h);
  const selectBefore = await h.snapshot();
  assertEqual(
    selectBefore.screen,
    "select",
    "entering the campaign lands on the select grid",
  );
  await fireAction(h, "clear");
  await captureStill(h, "unchanged");
  const selectAfter = await h.snapshot();
  assertDeepEqual(
    gameFields(selectAfter),
    gameFields(selectBefore),
    "the clear action fired on the select screen changes nothing",
  );
});
