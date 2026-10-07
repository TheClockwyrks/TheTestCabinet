// Deepcore — notices/notices-reset-on-a-fresh-expedition: a new expedition arms
// both hazard notices again.
//
// `specs/hazards.md`: "Each fires at most once per expedition and resets on a
// fresh one." So both one-time flags are armed as already fired, and an
// expedition is then started fresh; both must read `false` again, with no card
// carried over.
//
// A fresh expedition is begun the only way the game begins one — `specs/ui.md`:
// "A size begins the expedition in the mode chosen at `mode-select`" — so the
// check poses `size-select` with a size highlighted and presses `activate`. That
// press is the behaviour under test rather than a route to it: there is no
// expedition-start that does not go through choosing a size.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { SIZE_ITEMS } from "../constants";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  openScene,
  type Harness,
} from "../harness";

/** `SIZE_ITEMS` is `QUICK`, `STANDARD`, `MARATHON`, `BACK`. */
const STANDARD_INDEX = SIZE_ITEMS.indexOf("STANDARD");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears both one-time hazard notices when a fresh expedition starts", async () => {
  await openScene(h);
  await h.debug.setNoticeFired("gas", true);
  await h.debug.setNoticeFired("lava", true);

  const armed = await h.snapshot();
  assertEqual(armed.noticesFired.gas, true, "the gas notice posed as fired");
  assertEqual(armed.noticesFired.lava, true, "the lava notice posed as fired");

  await h.debug.setScreen("size-select");
  await h.debug.setMenuIndex(STANDARD_INDEX);
  await h.tap(ACTION_KEY.activate);
  await h.advance(1);
  await captureStill(h, "fresh");

  const fresh = await h.snapshot();
  assertEqual(
    fresh.screen,
    "in-mine",
    "the screen a started expedition opens on",
  );
  assertEqual(
    fresh.noticesFired.gas,
    false,
    "the gas notice on a fresh expedition",
  );
  assertEqual(
    fresh.noticesFired.lava,
    false,
    "the lava notice on a fresh expedition",
  );
  assertNull(fresh.notice, "no card carried into a fresh expedition");
});
