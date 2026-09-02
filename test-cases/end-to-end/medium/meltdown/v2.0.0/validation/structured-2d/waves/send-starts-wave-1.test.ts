// Meltdown — waves/send-starts-wave-1: sending from the opening phase begins
// Wave 1.
//
// `specs/waves.md`, The opening phase: "Sending is what begins Wave 1."
// `specs/controls.md` gives the `send` action as sending the next wave, or
// beginning Wave 1 from the opening phase, and `specs/waves.md`'s release rule
// fixes what beginning a wave does: "A wave releases its units one at a time,
// one every `WAVE_SPAWN_INTERVAL` (`0.6`) seconds of game time, the first on the
// frame the wave begins."
//
// THE SEND IS THE PLAYER'S SEND, pressed through the key `specs/controls.md`
// binds the action to and read out of `BINDINGS`, because the debug surface
// carries no send: sending is an act with several consequences, and this point
// is about the first two of them.
//
// THE WORLD GATE IS OPEN, because the release is half of what is under test.
// With it shut the spawner would hold `wavePending` whatever the send did
// (`specs/instrumentation.md`) and the floor would stay empty however correct
// the build was. It is one of the items that gate exists for.
//
// A SECOND FRAME IS RUN BEFORE THE FLOOR IS READ. `specs/waves.md` releases the
// first unit on the frame the wave begins, so a conformant build has already put
// one out by the end of the send's own frame; the extra frame costs a tenth of
// one spawn interval and means a build that resolves its release a frame after
// the phase change is graded on whether it releases at all, which is this point,
// and not on when, which is `surge.spawn-cadence`.
//
// NOTHING IS ASSERTED ABOUT WHAT WAS RELEASED. Which type a wave fields, how
// many it carries and which vent each unit draws are `surge`'s points; what this
// one requires is that the send moved the phase to `wave`, left the number on
// Wave 1, and set the spawner going.
//
// WHAT EVERY WRONG MODEL READS. A build whose send does nothing in the opening
// phase stays in `opening` with an empty floor; one that moves the phase but
// never starts the spawner reads `wave` with an empty floor; one that sends the
// wave AFTER the one being prepared for reads wave `2`.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The key `specs/controls.md` binds the send to. */
const SEND_KEY = BINDINGS.send[0];

/** The wave a send from the opening phase begins (`specs/waves.md`). */
const FIRST_WAVE = 1;

/** The least the spawner must have put on the floor: one unit. */
const RELEASED_AT_LEAST = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the phase to wave and starts the spawner", async () => {
  startRun(h);
  h.debug.setPhase("opening");
  h.debug.setBuildTimer(0);
  h.debug.setWaveSpawning(true);

  await h.tap(SEND_KEY);
  await h.advance(1);

  const sent = h.snapshot();
  captureStill(h, "sent");

  assertEqual(sent.phase, "wave", "the phase the send from the opening left");
  assertEqual(sent.wave, FIRST_WAVE, "the wave the send began");
  assertGreaterThanOrEqual(
    sent.surge.length,
    RELEASED_AT_LEAST,
    "the units the spawner had released one frame after the send",
  );
});
