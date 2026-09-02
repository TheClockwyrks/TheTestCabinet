// lives/invuln-counts-down — the respawn grace falls by exactly the game time
// that passes.
//
// THE RULE. `specs/progression.md` gives a respawned ship "`INVULN_TIME` (`2.5`
// seconds) of respawn grace" and has "lethal contact resume on the tick the
// grace reaches `0`", and `specs/instrumentation.md` reports `ship.invuln` as
// "seconds of respawn grace left". A quantity stated in seconds that runs out
// after a stated number of them is one that falls with game time, at the rate
// game time passes, which is what this item reads. That the window OPENS at
// `INVULN_TIME` is `lives/invuln-window`'s point; this one decides the descent
// from wherever it opened, so a build that opens the window at the wrong figure
// but counts it down honestly loses one point rather than two.
//
// THE WINDOW IS POSED RATHER THAN EARNED. `setShipInvuln(seconds)` "sets the
// seconds of respawn grace remaining" (`specs/instrumentation.md`), so the
// scenario is one call and holds nothing else: no rock, no saucer, no contact.
// A check that killed a ship to reach the same reading would be deciding the
// contact rules and the respawn as well as this one, and a build that failed
// either would lose this point for a reason that is not this point.
//
// THREE SAMPLES, and each is its own reading of the same rule at a different
// distance down the window: a build whose grace runs at half speed, one that
// runs it off the wall clock rather than the game's, and one that drops it to
// zero in one step each read a different number at each of them.
//
// The tolerance is one tick of game time (`TICK_DT`, 1/120 s), which is the
// resolution `specs/simulation.md` fixes the simulation at: a build that
// decrements before the frame it was asked for and one that decrements after
// differ by exactly that and are both conformant.

import { afterEach, beforeEach, it } from "vitest";
import { INVULN_TIME, TICK_DT } from "../constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** How far a sample may sit from the time it is predicted at, in seconds. */
const COUNTDOWN_TOLERANCE = TICK_DT;

/** How far down the window the grace is read, in seconds of game time. */
const SAMPLES = [0.5, 1.0, 2.0] as const;

/** The sample whose frame is kept as the item's picture: the middle one. */
const PICTURED = 1.0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("runs the respawn grace down with game time", async () => {
  startPlaying(h);
  h.debug.setShipInvuln(INVULN_TIME);

  assertEqual(
    h.snapshot().ship.invuln,
    INVULN_TIME,
    "setShipInvuln to be reported by the snapshot before any frame runs " +
      "(specs/instrumentation.md)",
  );

  let run = 0;
  for (const at of SAMPLES) {
    const wanted = ticksFor(at);
    await h.advance(wanted - run);
    run = wanted;
    if (at === PICTURED) captureStill(h, "grace");

    assertLessThanOrEqual(
      Math.abs(h.snapshot().ship.invuln - (INVULN_TIME - at)),
      COUNTDOWN_TOLERANCE,
      `the grace left after ${at.toFixed(1)} s of game time, which is ` +
        `INVULN_TIME less the time advanced (specs/progression.md)`,
    );
  }
});
