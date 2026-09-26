// Meltdown — controls/send-key: Space sends the wave.
//
// specs/controls.md binds `send` to `Space` and gives it the effect "Sends the
// next wave, or begins Wave 1 from the opening phase." specs/waves.md says what
// that does to a between-wave build phase: its timer falls, and "Reaching `0`
// starts the wave, and sending starts it earlier." The phase a wave is being
// fought in is `wave`, which specs/instrumentation.md reports as `phase`.
//
// THE PHASE IS THE WHOLE READING. What a started wave then does — how many units
// it fields, of which type, at what cadence, and what the early send pays — is
// `waves.wave-type-progression`, `waves.wave-size`, `waves.spawn-cadence` and
// `economy.early-send-bonus`. This point decides one thing: that the key reaches
// the send action.
//
// THE BUILD PHASE, NOT THE OPENING PHASE. The action has two jobs and this is the
// one the item names — "`Space` in a build phase moves the phase to `wave`" — so
// the run is posed at the between-wave phase `startRun` leaves it in.
// `waves.opening-phase-sends-wave-one` is where the other job is read.
//
// THE WORLD GATE STAYS SHUT, and that is deliberate rather than incidental.
// specs/instrumentation.md defines the gate as holding "The run's own release of
// surge: the build timer's automatic start of the next wave when it reaches `0`,
// and the spawner's release of the units counted by `wavePending`" — the run's own
// release, not the player's. A press of `Space` is the player's, so it is not what
// the gate holds, and shutting the gate is what keeps the fifteen seconds of
// `BUILD_PHASE_TIME` from starting a wave underneath the reading and what keeps
// the spawner from putting a unit on the floor while it is taken.
//
// A FRESH BUILD PHASE, SO THE TIMER CANNOT BE THE THING THAT STARTED IT.
// `startRun` poses the timer at the full `BUILD_PHASE_TIME`, fifteen seconds, and
// the press is read two frames later — a sixtieth of a second of game time. A
// build whose phase moved because its own countdown expired could not have got
// there in the time this scenario spends, so the transition read below can only be
// the key's.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The key specs/controls.md binds `send` to, and the only one. */
const KEY = BINDINGS.send;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("moves a build phase to the wave phase when Space is pressed", async () => {
  await startRun(h);
  await h.advance(1);
  const before = await h.snapshot();
  assertEqual(before.phase, "building", "the phase the scenario is posed in");

  await h.tap(KEY);
  await h.advance(1);
  const after = await h.snapshot();
  await captureStill(h, "sent");

  assertEqual(
    after.phase,
    "wave",
    `${KEY}: the phase one press leaves a fresh build phase in`,
  );
});
