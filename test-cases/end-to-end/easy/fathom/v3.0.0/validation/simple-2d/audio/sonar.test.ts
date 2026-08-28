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
// THE CUE IS READ BY NAME. The game asks the runtime's cue bus for a cue by name
// and the bus announces the play (`specs/progression.md`), so what is asserted
// here is the exact name that file fixes, sounding exactly ONCE on the event's own
// tick — which is the "at most once on that tick" half of the requirement — and
// not at all on the ticks before it.
//
// WHAT THIS DOES NOT DECIDE. What the pulse reveals, which the `sonar/*` points
// own; the cooldown it starts, which is `sonar/cooldown`'s.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, CUES } from "../../src/constants";
import { assertEqual, assertNull } from "../assert";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";
import {
  clearUnderfoot,
  denAll,
  graded,
  parkForager,
  sceneGuard,
  sceneHeld,
} from "../scene";
import { cuesBeforeEvent, cuesOnEvent, watchForEvent } from "./cues";

/** The key `specs/movement.md` binds the `a` action to: it emits a sonar pulse. */
const SONAR_KEY = BINDINGS.a[0];

/**
 * The frames the key is held for.
 *
 * The press is delivered before the first frame of the watch, and live play reads
 * `a` once per press (`specs/movement.md`), so a conforming build casts on that
 * first tick. Half a second is a hard ceiling sixty times that, so a build that
 * never casts fails on the bound rather than leaving the point inconclusive.
 */
const PULSE_TICKS = ticks(0.5);

/** Frames run past the reading, purely so the clip shows the wavefront travel. */
const TAIL_TICKS = ticks(1);

/**
 * Ticks the watch runs before the key goes down, so the quiet it reads is a
 * window rather than nothing.
 *
 * A quarter of a second on a board where the forager is parked facing rock and
 * every hunter is in the den. Without it the event lands on the watch's very
 * first tick — live play reads the action once per press (`specs/movement.md`) —
 * and "nothing sounded before it" would be a reading of no ticks at all.
 */
const QUIET_LEAD = ticks(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.sonar on the tick the forager emits a pulse, and not before", async (ctx) => {
  await graded(ctx, async () => {
    await startPlaying(h);
    const quiet = await denAll(h);
    await parkForager(h);
    await clearUnderfoot(h);
    h.debug.setSonarCooldown(0);
    const watch = await sceneGuard(h, quiet);

    const seen = await captureReplay(h, "sonar", async () => {
      try {
        const found = await watchForEvent(
          h,
          (s) => s.pulses.some((pulse) => pulse.source === "forager"),
          QUIET_LEAD + PULSE_TICKS,
          {
            quietLead: QUIET_LEAD,
            arm: () => {
              h.hold(SONAR_KEY);
            },
          },
        );
        // Held on past the reading, so the clip shows the wavefront flooding the
        // corridors. Nothing after this line can reach an assertion.
        await h.advance(TAIL_TICKS);
        return found;
      } finally {
        h.release(SONAR_KEY);
      }
    });

    assertNull(sceneHeld(h.snapshot(), watch), "the scenario held to the end");

    assertEqual(
      seen.hit,
      true,
      `a wavefront the forager cast entered flight inside the ${String(PULSE_TICKS)} ` +
        "ticks the check holds Space for, with the cooldown posed ready",
    );
    assertEqual(
      cuesBeforeEvent(seen, CUES.sonar),
      0,
      `times CUES.sonar played over the ${String(seen.at - 1)} ticks before the ` +
        "pulse — a cue is played on the tick its event happens " +
        "(specs/progression.md)",
    );
    assertEqual(
      cuesOnEvent(seen, CUES.sonar),
      1,
      "times CUES.sonar played on the tick the forager cast its pulse, which is " +
        "its own tick and at most once on it (specs/progression.md)",
    );
  });
});
