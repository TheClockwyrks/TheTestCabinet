// screens/title-from-howto-highlights-howto — returning from How To Play
// highlights the entry that led there.
//
// specs/screens.md, "What is highlighted on arrival": "Arriving at a
// menu-bearing screen highlights the entry that led away from it to the screen
// just left", and its table gives `title`, entered from `howto`, entry `1`, HOW
// TO PLAY. The return itself is specs/screens.md's `howto` rule: "`confirm` and
// `back` both return to `title`."
//
// THE RETURN IS A REAL ONE, because the arrival rule is about a transition and
// `setScreen` sets the screen and nothing else. The route pressed is `confirm`
// alone, on the screen the point is about; the other three arrivals are their
// own points, since a build may remember one route and not another.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, TITLE_MENU } from "../constants";
import {
  captureStill,
  openHarness,
  poseScene,
  tap,
  type Harness,
} from "../harness";

/** The key that carries `confirm` alone — `Space` also carries `launch`. */
const CONFIRM = BINDINGS.confirm[1];

/** Entry 1 of the title menu: HOW TO PLAY, the entry that led to `howto`. */
const HOWTO_ENTRY = TITLE_MENU.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("highlights HOW TO PLAY on the title returned to from howto", async () => {
  const posed = await poseScene(h, "howto");
  assertEqual(posed.screen, "howto", "the screen the return is made from");

  await tap(h, CONFIRM);
  await h.frameDraw();
  await captureStill(h, "returned");

  const after = await h.snapshot();
  assertEqual(after.screen, "title", "the screen the return landed on");
  assertEqual(
    after.menu.index,
    HOWTO_ENTRY,
    "the highlight on arrival: the entry that led to howto",
  );
});
