// states/dive-opens-countdown — a dive opens on the countdown, not on live play.
//
// specs/ui.md's transition table: `"title"` + `DIVE` confirmed -> `"countdown"`,
// "at the start of a fresh dive". The miss this point catches is a build that
// takes `DIVE` straight into `"playing"`, which costs the player the run-up the
// screen exists to give them.
//
// THE SCREEN IS READ TWICE OVER. Once from `snapshot().screen`, and once from
// what the frame drew: specs/ui.md gives the countdown screen as "the maze view
// and the HUD, with a short `DIVE` countdown drawn over them", so the HUD's depth
// readout standing behind the countdown is what says the maze view is there at
// all. A build that reports the screen and draws a blank one fails here rather
// than passing on the half it got right.
//
// THE SELECTION IS POSED, NEVER WALKED. `setMenuIndex` puts the highlight on
// `DIVE` (specs/instrumentation.md) and one `confirm` takes it, so a build with a
// broken `down` action fails `controls` and passes this. HOW LONG the countdown
// holds is `states.countdown-duration`, and what holds still behind it is
// `states.countdown-freeze`.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";
import { assertDrew, frameOps } from "./screens";

/** The key specs/movement.md binds `confirm` to first: it takes a menu item. */
const CONFIRM_KEY = BINDINGS.confirm[0];

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const DIVE = TITLE_ITEMS.indexOf("DIVE");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the dive on the countdown, over the maze and the HUD", async () => {
  openTitle(h);
  h.debug.setMenuIndex(DIVE);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the screen the confirm is made on");
  assertEqual(posed.menuIndex, DIVE, "the posed title selection");

  await h.tap(CONFIRM_KEY);
  const entered = h.snapshot();
  const ops = await frameOps(h);
  // Before the assertions, so a failing check still leaves the screen it read.
  captureStill(h, "countdown");

  assertEqual(
    entered.screen,
    "countdown",
    "the screen DIVE confirmed on the title menu reaches (specs/ui.md)",
  );
  assertDrew(
    ops,
    `DEPTH ${String(entered.depth)}`,
    "the HUD's depth readout, drawn behind the countdown because the maze " +
      "view and the HUD are what it is drawn over (specs/ui.md)",
  );
});
