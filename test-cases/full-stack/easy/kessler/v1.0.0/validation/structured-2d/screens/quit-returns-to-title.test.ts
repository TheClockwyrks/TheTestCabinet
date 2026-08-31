// screens/quit-returns-to-title — confirming QUIT returns to the title.
//
// specs/screens.md, on `paused`: "`confirm` on `QUIT` discards the session
// and returns to `title`." QUIT is entry `1` of the pause menu, and the menu
// is the only route onto it — the surface poses no highlight — so the
// highlight is moved there with one real `down` press first, checked as a
// precondition. Whether the session was discarded is the states category's
// point; what is decided here is the screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { captureStill, openHarness, tap, type Harness } from "../harness";
import { posePaused } from "./scenes";

/** The key that carries `confirm` alone — `Space` also carries `launch`. */
const CONFIRM = BINDINGS.confirm[1];
/** The key specs/controls.md binds to `down`. */
const DOWN = BINDINGS.down[0];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirm on QUIT sets screen to title", async () => {
  const posed = posePaused(h);
  assertEqual(posed.screen, "paused", "the screen the menu is worked on");

  await tap(h, DOWN);
  assertEqual(h.snapshot().menu.index, 1, "the highlighted entry, QUIT");

  await tap(h, CONFIRM);
  captureStill(h, "title-after-quit");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen confirm on QUIT returned to",
  );
});
