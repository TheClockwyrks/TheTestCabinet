// campaign/wave-clears — a wave clears exactly when its last unit has gone.
//
// specs/campaign.md: "A wave is cleared when every unit it released has died or
// leaked. Clearing it pays the wave-clear bonus and opens the next build phase."
// So the rule has a before and an after, and both are read here: with one unit
// still on the yard the phase still reads `wave`, and the frame that unit is
// removed the phase reads `build`.
//
// THE WAVE IS ONE UNIT, AND THE CHECK CHOOSES IT. `spawnUnit` puts the run into
// a live wave "whose spawn schedule is empty, so the units on the yard are
// exactly the ones `spawnUnit` released and nothing else arrives"
// (specs/instrumentation.md), and that wave "clears the ordinary way, when every
// one of those units has died or leaked". So the wave read here holds exactly
// one unit, whose removal is the only thing that can clear it — rather than a
// composed wave, where a clear could as easily have come from a schedule running
// out.
//
// The unit's travel is held while the first half is read, which holds the wave
// open without holding anything else: a held unit is still targetable, still
// takes damage, still burns. Releasing its travel and letting it walk the last
// three tiles into the collector is what ends the wave, through the game's own
// leak rather than through anything posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { captureReplay, openYard, releaseUnit, type Harness } from "../harness";
import { createRunHarness, leakOne } from "./runs";

/** Long enough that a wave with a live unit on it would have cleared if it could. */
const HOLD = 240;

let h: Harness;

beforeEach(async () => {
  h = await createRunHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stays live while one unit stands and clears on the frame it goes", async () => {
  await openYard(h, { wave: 4, integrity: 50 });
  const id = await releaseUnit(h, "mote", { frozen: true });

  const opening = await h.snapshot();
  assertEqual(
    opening.phase,
    "wave",
    "releasing a unit puts the run into a wave",
  );

  const cleared = await captureReplay(h, "clear", async () => {
    await h.advance(HOLD);
    const holding = await h.snapshot();
    assertLength(holding.units, 1, "the wave's one unit is still on the yard");
    assertEqual(
      holding.phase,
      "wave",
      "a wave with a unit still on the yard has not cleared",
    );
    assertEqual(holding.waveActive, true, "the wave is still running");

    return leakOne(h, "mote", id);
  });

  assertLength(cleared.units, 0, "the wave's last unit has gone");
  assertEqual(
    cleared.phase,
    "build",
    "the frame the last unit went, the wave cleared into a build phase",
  );
  assertEqual(cleared.waveActive, false, "the wave is no longer running");
});
