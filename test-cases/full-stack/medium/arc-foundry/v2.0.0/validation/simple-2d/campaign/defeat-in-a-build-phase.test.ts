// campaign/defeat-in-a-build-phase — the run ends at zero in a build phase too.
//
// specs/economy.md: "Grid Integrity reaching `0` or below ends the run in defeat
// immediately, even mid-wave." specs/campaign.md's outcome table states the rule
// without a phase attached to it: "Defeat — Grid Integrity reaches `0`, at any
// point, including mid-wave. The defeat screen, immediately." AT ANY POINT is
// wider than mid-wave, and a build phase is the other point there is.
//
// So this is the sibling of `defeat-at-zero`, which drives a leak while a wave is
// running. Here nothing is running at all: no wave, no unit, no structure. The
// counter is simply put at `0` and the game is advanced, which is the arrangement
// specs/instrumentation.md licenses when it says `setIntegrity` "resolves no
// defeat by itself; the game's own rules resolve on the next advance".
//
// NOTHING ELSE IS POSED. A build that resolves defeat only where a leak happens,
// or only inside the branch of a tick a live wave reaches, plays on past this
// point, and no other check on the yard can tell you that.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** Frames advanced after the counter is emptied. "Immediately" is one; take two. */
const SETTLE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reaches the overload screen from a build phase with an empty yard", async () => {
  openYard(h);

  const posed = h.snapshot();
  assertEqual(posed.screen, "playing", "the run is being played");
  assertEqual(posed.phase, "build", "the run is in a build phase");
  assertLength(posed.units, 0, "the yard's live units");
  assertLength(posed.structures, 0, "the yard's structures");

  const defeated = await captureReplay(h, "overload", async () => {
    h.debug.setIntegrity(0);
    await h.advance(SETTLE);
    return h.snapshot();
  });

  assertEqual(
    defeated.screen,
    "overload",
    "Grid Integrity at zero ends the run in defeat at any point, so a build " +
      "phase reaches the defeat screen on the next advance",
  );
  assertEqual(
    defeated.phase,
    null,
    "the run is over, so no phase is being played",
  );
});
