// progression/starts-three-lives — a new run opens with START_LIVES lives.
//
// specs/progression.md, Starting a run: a new run opens on the `playing` screen
// with `START_LIVES` (`3`) lives. The run is opened the way a player opens one,
// through `confirm` on `DESCEND` — the title menu's first item, which is where
// the highlight rests on arriving at the title (specs/ui.md) — so what is graded
// is the run the build OPENS rather than a value left lying around.
//
// THE POSE IS THE DISTINGUISHING VALUE. `reset` already leaves `START_LIVES` on
// the title screen, so a check that confirmed and read `3` could not tell a
// build that opened a run from one whose `DESCEND` did nothing at all. The title
// is therefore left holding a lives count that is NOT the starting one: a build
// that opened no run reads that number back, and only a build that ran the
// start-of-run rule reads `START_LIVES`.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/**
 * The lives the title is left holding before `DESCEND` is confirmed.
 *
 * Any value but `START_LIVES` would do; `1` is chosen because it is a count a
 * run can really be at, so nothing about the pose is impossible, and it is far
 * enough from `3` that the two can never be confused in a failure message.
 */
const STALE_LIVES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a run reporting START_LIVES lives", async () => {
  resetTo(h);
  h.debug.setLives(STALE_LIVES);

  // The real registered action, on the real title menu, with the highlight where
  // `reset` left it — the first item, `DESCEND`.
  await tapAction(h, "confirm");
  captureStill(h, "opening");

  assertEqual(h.snapshot().lives, START_LIVES);
});
