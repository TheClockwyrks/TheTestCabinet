// Meltdown — controls/send-control: the panel's Send control sends the wave.
//
// THE RULE. specs/hud.md gives the control: "The panel carries a Send control,
// which reads Start while the phase is `opening`". specs/controls.md answers a
// press and release inside a panel control as "That control is operated", and
// gives `send` the effect "Sends the next wave, or begins Wave 1 from the opening
// phase." specs/waves.md says what that does to a between-wave build phase:
// "Reaching `0` starts the wave, and sending starts it earlier." The phase a wave
// is fought in is `wave`.
//
// THE CONTROL AND THE KEY ARE SEPARATE POINTS, because a build can wire one and
// not the other, and specs/controls.md requires that "Every interaction and every
// menu is reachable with the pointer alone". A build with a working `Space` and a
// dead Send control leaves a touchscreen player waiting out every build phase.
// `controls.send-key` reads the key.
//
// THE PHASE IS THE WHOLE READING. What a started wave then fields, at what
// cadence, and what the early send pays are `waves.*` and
// `economy.early-send-bonus`. That the control READS Start in the opening phase is
// `hud.*`.
//
// THE WORLD GATE STAYS SHUT, and deliberately. specs/instrumentation.md defines
// the gate as holding the RUN's own release of surge — the build timer's automatic
// start of the next wave, and the spawner's release of `wavePending` — not the
// player's. A tap on Send is the player's, so it is not what the gate holds, and
// shutting the gate is what keeps the fifteen seconds of `BUILD_PHASE_TIME` from
// starting a wave underneath the reading.
//
// A FRESH BUILD PHASE, SO THE TIMER CANNOT BE THE THING THAT STARTED IT.
// `startRun` poses the timer at the full `BUILD_PHASE_TIME`, fifteen seconds, and
// the tap is read two frames later — a sixtieth of a second of game time — so the
// transition read below can only be the control's.
//
// THE RECTANGLE IS THE BUILD'S OWN, read off the snapshot, and specs/hud.md
// carries Send at all times during a run, so this one is never null.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  clickControl,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves a build phase to the wave phase when the reported Send rectangle is tapped", async () => {
  startRun(h);
  await h.advance(1);
  const before = h.snapshot();
  assertEqual(
    before.phase,
    "building",
    "posing: the phase the scenario is posed in (specs/waves.md)",
  );

  await clickControl(h, before.controls.send);
  captureStill(h, "sent");

  assertEqual(
    h.snapshot().phase,
    "wave",
    "the phase a press and release inside the reported send rectangle leaves " +
      "a fresh build phase in (specs/hud.md, specs/waves.md)",
  );
});
