// screens/title-from-quit-highlights-start — a session left through QUIT lands
// on START.
//
// specs/screens.md, "What is highlighted on arrival": its table gives `title`,
// entered from `playing`, `paused`, or `gameover`, entry `0`, START — "the entry
// that led away from it to the screen just left", which for a session is the
// START that began it. The route is specs/screens.md's `paused` rule: "`confirm`
// on `QUIT` discards the session and returns to `title`."
//
// THE HIGHLIGHT IS POSED ONTO QUIT rather than walked there with the `down` key,
// so a build whose only fault is its `down` key fails that key's own point and
// not this one. The confirm is a real press, because the arrival rule is about a
// transition and `setScreen` sets the screen and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  openHarness,
  poseMenu,
  startFreshSession,
  tap,
  type Harness,
} from "../harness";

/** The key that carries `confirm` alone — `Space` also carries `launch`. */
const CONFIRM = BINDINGS.confirm[1];

/** Entry 1 of the pause menu: QUIT. */
const QUIT_ENTRY = PAUSE_ITEMS.indexOf("QUIT");

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("highlights START on the title a quit returned to", async () => {
  startFreshSession(h);
  const posed = poseMenu(h, "paused", QUIT_ENTRY);
  assertEqual(
    posed.menu.index,
    QUIT_ENTRY,
    "QUIT highlighted before the confirm",
  );

  await tap(h, CONFIRM);
  await h.frameDraw();
  captureStill(h, "quit");

  const after = h.snapshot();
  assertEqual(after.screen, "title", "the screen the quit returned to");
  assertEqual(after.menu.index, 0, "the highlight on arrival: START");
});
