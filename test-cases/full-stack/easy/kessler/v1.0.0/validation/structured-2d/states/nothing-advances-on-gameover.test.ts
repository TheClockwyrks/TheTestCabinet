// states/nothing-advances-on-gameover — on the gameover screen no part of the
// simulation advances however much time passes.
//
// specs/screens.md, "What advances on each screen": `gameover` — "Nothing."
// A field is posed UNDER the screen first — a score, a ball in flight, a
// falling pod, over the full wave-1 rings — and the whole snapshot must then
// hold, field for field, across two seconds of driven time, minus one field:
// specs/instrumentation.md fixes the snapshot's `ticks` as "ticks resolved
// since the last reset, on every screen; frozen screens still count them", so
// the tick counter is the one field a frozen screen moves and it is left out
// of the comparison.
//
// The gameover screen is entered through the surface — "exactly as losing the
// last life enters it, showing the score and wave as they stand" — because
// whether a life loss REACHES gameover is a session point, not this one. The
// comparison baseline is read after the entry, so whatever the entry itself
// leaves standing is exactly what must then hold.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  advanceTicks,
  captureReplay,
  openHarness,
  spawnBallPolar,
  spawnPodPolar,
  type Harness,
} from "../harness";
import { HELD_TICKS, stillSnapshot } from "./still";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the whole simulation on the gameover screen", async () => {
  h.reset();
  h.debug.setScreen("playing");
  h.debug.setScore(555);
  spawnBallPolar(h, 300, 40, 240, 0);
  spawnPodPolar(h, "shield", 420, 250);
  h.debug.setScreen("gameover");
  const entered = h.snapshot();
  assertEqual(entered.screen, "gameover", "the screen the time passes on");

  await captureReplay(h, "gameover-held", () => advanceTicks(h, HELD_TICKS));

  assertDeepEqual(
    stillSnapshot(h.snapshot()),
    stillSnapshot(entered),
    `every snapshot field but the tick counter, after ${HELD_TICKS} ticks on gameover`,
  );
});
