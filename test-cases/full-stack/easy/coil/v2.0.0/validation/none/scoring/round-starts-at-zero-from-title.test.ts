// scoring/round-starts-at-zero-from-title — the mode entry opens the next round
// at zero.
//
// specs/scoring.md: "A round starts at a score of `0`." specs/ui.md gives a round
// two openings, and this is one of them: `confirm` on the mode's entry, the first
// item of the title menu, which "starts a round". The other opening is
// `scoring/round-starts-at-zero-from-gameover`, and they are two points because a
// build commonly carries the score across one route and not the other.
//
// THE ROUND IS OPENED WITH A KEY, not by assigning the screen:
// specs/instrumentation.md makes `setScreen("playing")` run the tick over the
// board AS IT STANDS rather than laying out a fresh round, so the only thing that
// opens one is `confirm` on a menu item.
//
// A score is on the board before the opening, because the failure this decides is
// a round that CARRIES a score into the next one. specs/instrumentation.md leaves
// `setScreen` changing no other field, so the title this presses on is a title
// standing over a score of `CARRIED`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** The score standing on the game when the title is confirmed. */
const CARRIED = 320;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the round the mode entry starts at a score of zero", async () => {
  const title = await poseScene(h, {
    screen: "title",
    menuIndex: 0,
    score: CARRIED,
  });
  assertEqual(title.screen, "title", "the screen the key is pressed on");
  assertEqual(title.score, CARRIED, "the score standing before the opening");

  await h.tap(KEY.confirm);
  await captureStill(h, "fresh");

  const fresh = await h.snapshot();
  assertEqual(fresh.screen, "playing", "the screen the mode entry opened");
  assertEqual(fresh.score, 0, "the score a round from the title opens at");
});
