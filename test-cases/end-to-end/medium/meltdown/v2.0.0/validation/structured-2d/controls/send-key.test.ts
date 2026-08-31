// Meltdown — controls/send-key: Space sends the wave.
//
// THE RULE. `send` "sends the next wave, or begins Wave 1 from the opening
// phase" (specs/controls.md, The actions) and is bound to `Space` (The
// bindings). What sending does to a build phase is specs/waves.md, A build
// phase: "Reaching `0` starts the wave, and sending starts it earlier" — so the
// run leaves `building` for `wave` on the press rather than when the timer runs
// out.
//
// WHAT IS AND IS NOT DECIDED HERE. The phase, and nothing else. The early-send
// bonus of specs/economy.md is `economy`'s item and the release cadence is
// `waves`'s, so neither the money nor the units are read: a build that sends the
// wave but pays the wrong bonus must lose the economy item alone.
//
// The scenario is a plain build phase over an empty, quiet floor. The world gate
// holds only "the build timer's automatic start of the next wave when it reaches
// `0`" and the spawner's release (specs/instrumentation.md, The world gate), so a
// send is answered with it off exactly as it is with it on — which is what makes
// the reading a reading of the press and not of the timer.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, startRun, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves a build phase into its wave phase", async () => {
  startRun(h);
  assertEqual(h.snapshot().phase, "building", "the phase the press starts from");

  await h.tap("Space");
  captureStill(h, "sent");

  const sent = h.snapshot();
  assertEqual(sent.phase, "wave", "the phase Space left the run in");
  assertEqual(sent.screen, "playing", "the screen, which a send does not leave");
});
