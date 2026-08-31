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
// THE CONTROL AND THE KEY ARE SEPARATE ITEMS, because a build can wire one and not
// the other, and specs/controls.md requires that "Every interaction and every menu
// is reachable with the pointer alone". A build with a working Space and a dead
// Send control leaves a touchscreen player waiting out every build phase.
// `controls.send-key` reads the key.
//
// THE PHASE IS THE WHOLE READING. What a started wave then fields, at what cadence,
// and what the early send pays are `waves.*` and `economy.early-send-bonus`. That
// the control READS Start in the opening phase is `hud.*`.
//
// THE WORLD GATE STAYS SHUT, AND DELIBERATELY. specs/instrumentation.md defines the
// gate as holding the RUN's own release of surge — "the build timer's automatic
// start of the next wave when it reaches `0`, and the spawner's release of the
// units counted by `wavePending`". A tap on Send is the PLAYER's, so it is not what
// the gate holds, and shutting the gate is what keeps `BUILD_PHASE_TIME` from
// starting a wave underneath the reading.
//
// A FRESH BUILD PHASE, SO THE TIMER CANNOT BE THE THING THAT STARTED IT.
// `startRun` poses the timer at the full `BUILD_PHASE_TIME` — fifteen seconds — and
// the tap is read three frames later, a fortieth of a second of game time, so the
// transition read below can only be the control's.
//
// THE RECTANGLE IS THE BUILD'S OWN, read off the snapshot, and specs/hud.md carries
// Send at all times during a run, so this one is never null.

import { afterEach, beforeEach, it } from "vitest";
import { BUILD_PHASE_TIME } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  tapControl,
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
  assertEqual(before.phase, "building", "the phase the scenario is posed in");
  // Whole seconds of build timer still to run, so the transition below cannot be
  // the timer reaching 0 (specs/waves.md, A build phase).
  assertGreaterThan(
    before.buildTimer,
    BUILD_PHASE_TIME / 2,
    "the seconds left on the posed build timer",
  );

  await tapControl(h, before.controls.send);
  captureStill(h, "sent");

  const after = h.snapshot();
  assertEqual(
    after.phase,
    "wave",
    "the phase a press and release inside the reported send rectangle leaves a fresh build phase in",
  );
  assertEqual(
    after.screen,
    "playing",
    "the screen, which a send does not leave",
  );
});
