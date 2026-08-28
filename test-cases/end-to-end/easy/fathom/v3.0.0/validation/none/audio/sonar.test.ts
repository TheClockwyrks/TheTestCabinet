// audio/sonar — the sonar cue.
//
// `specs/progression.md` fixes `CUES.sonar` (`"sonar"`) as the cue played when
// "the forager emits a sonar pulse", and governs all seven with one sentence:
// "Each is played on the tick its event happens, and at most once on that tick."
//
// THE PULSE IS FIRED BY KEY, NOT POSED. `specs/instrumentation.md` gives the
// surface no operation that casts a pulse, and `specs/movement.md` binds the `a`
// action to `Space` and has live play read it "once per press". So the cooldown is
// posed ready and the key is held across the watch: the pulse the cue is read
// against is one the build's own ability code cast.
//
// THE EVENT IS THE WAVEFRONT ENTERING FLIGHT, which `specs/state.md` reports as a
// `pulses` entry whose `source` is `"forager"` — not the cooldown starting, which
// is a consequence a build may record on its own schedule.
//
// The forager is a bystander here, parked facing rock, and every hunter is in the
// den, so the ticks before the pulse carry nothing at all.
//
// WHAT THIS ENGINE CANNOT SEE. The cue's NAME, and how many sources one cue is
// made of. `validation/audio/cues.ts` states why, and what these checks assert
// instead.
//
// WHAT THIS DOES NOT DECIDE. What the pulse reveals, which the `sonar/*` points
// own; the cooldown it starts, which is `sonar/cooldown`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertNull } from "../assert";
import { BINDINGS, ticksFor } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import {
  denAllExcept,
  quietBoard,
  sceneGuard,
  sceneHeld,
  startPlaying,
} from "../scene";
import { soundsBeforeEvent, soundsOnEvent, watchForEvent } from "./cues";

/** The key `specs/movement.md` binds the `a` action to: it emits a sonar pulse. */
const SONAR_KEY = BINDINGS.a[0];

/**
 * The ticks the key is held for.
 *
 * The press is delivered before the first tick of the watch, and live play reads
 * `a` once per press (`specs/movement.md`), so a conforming build casts on that
 * first tick. Half a second is a hard ceiling sixty times that, so a build that
 * never casts fails on the bound rather than leaving the point inconclusive.
 */
const PULSE_TICKS = ticksFor(0.5);

/** Ticks run past the reading, purely so the clip shows the wavefront traveling. */
const TAIL_TICKS = ticksFor(1);

/**
 * Ticks the watch runs before the key goes down, so the quiet it reads is a
 * window rather than nothing.
 *
 * A quarter of a second on a board where the forager is parked facing rock and
 * every hunter is in the den. Without it the event lands on the watch's very
 * first tick — live play reads the action once per press (`specs/movement.md`) —
 * and "nothing sounded before it" would be a reading of no ticks at all.
 */
const QUIET_LEAD = ticksFor(0.25);

let h: Harness;

beforeEach(async (ctx) => {
  h = await createHarness(ctx);
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the tick the forager emits a sonar pulse, and not before", async () => {
  // A real, browser-trusted gesture first: an engineless build owns its own audio
  // layer and is entitled to open it on the player's first interaction alone
  // (`specs/progression.md`). The key is bound to nothing, so this changes no state.
  await h.armAudio();
  await startPlaying(h);
  const quiet = await denAllExcept(h);
  await quietBoard(h);
  await h.debug.setSonarCooldown(0);
  const guard = await sceneGuard(h, quiet);

  const watch = await captureReplay(h, "sonar", async () => {
    try {
      const seen = await watchForEvent(
        h,
        (s) => s.pulses.some((pulse) => pulse.source === "forager"),
        QUIET_LEAD + PULSE_TICKS,
        {
          quietLead: QUIET_LEAD,
          arm: async () => {
            await h.hold(SONAR_KEY);
          },
        },
      );
      // Held on past the reading, so the clip shows the wavefront flooding the
      // corridors. Nothing after this line can reach an assertion.
      await h.advance(TAIL_TICKS);
      return seen;
    } finally {
      await h.release(SONAR_KEY);
    }
  });

  assertNull(
    sceneHeld(await h.snapshot(), guard),
    "the scenario held to the end",
  );

  assertEqual(
    watch.hit,
    true,
    `a wavefront the forager cast entered flight inside the ${String(PULSE_TICKS)} ` +
      "ticks the check holds Space for, with the cooldown posed ready",
  );
  assertEqual(
    soundsBeforeEvent(watch),
    0,
    `sounds the build emitted over the ${String(watch.at - 1)} ticks before the ` +
      "pulse, on a board where nothing else is happening — a cue is played on " +
      "the tick its event happens (specs/progression.md)",
  );
  assertGreaterThanOrEqual(
    soundsOnEvent(watch),
    1,
    "sounds the build emitted on the tick the forager cast its pulse, which is " +
      "the tick CUES.sonar is played on (specs/progression.md)",
  );
});
