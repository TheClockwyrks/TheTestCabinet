// audio/ink — the ink cue.
//
// `specs/progression.md` fixes `CUES.ink` (`"ink"`) as the cue played when "the
// forager releases an ink cloud", and governs all seven with one sentence: "Each
// is played on the tick its event happens, and at most once on that tick."
//
// THE CLOUD IS RELEASED BY KEY, NOT POSED. `specs/instrumentation.md` gives the
// surface no operation that drops a cloud, and `specs/movement.md` binds the `b`
// action to `ShiftLeft` and `ShiftRight` and has live play read it "once per
// press". So the cooldown is posed ready and the key is held across the watch:
// the release the cue is read against is one the build's own ability code made.
//
// THE EVENT IS THE CLOUD STANDING ON THE BOARD, which `specs/state.md` reports as
// an `inkClouds` entry — not the cooldown starting, which is a consequence a
// build may record on its own schedule.
//
// The forager is a bystander here, parked facing rock, and every hunter is in the
// den, so the ticks before the release carry nothing at all.
//
// THE CUE IS READ BY NAME. The game asks the runtime's cue bus for a cue by name
// and the bus announces the play (`specs/progression.md`), so what is asserted
// here is the exact name that file fixes, sounding exactly ONCE on the event's own
// tick — which is the "at most once on that tick" half of the requirement — and
// not at all on the ticks before it.
//
// WHAT THIS DOES NOT DECIDE. What the cloud does to a hunter, which the
// `lanternjaw/*`, `gloamfin/*` and `flarefish/*` points own; how long it stands,
// which is `ink/cloud`'s; the cooldown it starts, which is `ink/cooldown`'s.

import { afterEach, beforeEach } from "vitest";
import { BINDINGS, CUES } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  check,
  clearUnderfoot,
  denAll,
  parkForager,
  requireScene,
  sceneGuard,
} from "../scene";
import { cuesBeforeEvent, cuesOnEvent, watchForEvent } from "./cues";

/** The key `specs/movement.md` binds the `b` action to first: it releases ink. */
const INK_KEY = BINDINGS.b[0];

/**
 * The frames the key is held for.
 *
 * The press is delivered before the first frame of the watch, and live play reads
 * `b` once per press (`specs/movement.md`), so a conforming build releases on
 * that first tick. Half a second is a hard ceiling sixty times that, so a build
 * that never releases fails on the bound rather than leaving the point
 * inconclusive.
 */
const RELEASE_TICKS = ticksFor(0.5);

/** Frames run past the reading, purely so the clip shows the cloud standing. */
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

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

check(
  "plays CUES.ink on the tick the forager releases ink, and not before",
  async () => {
    startPlaying(h);
    const quiet = await denAll(h);
    await parkForager(h);
    await clearUnderfoot(h);
    h.debug.setInkCooldown(0);
    const watch = await sceneGuard(h, quiet);

    const seen = await captureReplay(h, "ink", async () => {
      try {
        const found = await watchForEvent(
          h,
          (s) => s.inkClouds.length > 0,
          QUIET_LEAD + RELEASE_TICKS,
          {
            quietLead: QUIET_LEAD,
            arm: () => {
              h.hold(INK_KEY);
            },
          },
        );
        // Held on past the reading, so the clip shows the cloud standing. Nothing
        // after this line can reach an assertion.
        await h.advance(TAIL_TICKS);
        return found;
      } finally {
        h.release(INK_KEY);
      }
    });

    requireScene(h.snapshot(), watch);

    assertEqual(
      seen.hit,
      true,
      `an ink cloud stood on the board inside the ${String(RELEASE_TICKS)} ticks ` +
        "the check holds Shift for, with the cooldown posed ready",
    );
    assertEqual(
      cuesBeforeEvent(seen, CUES.ink),
      0,
      `times CUES.ink played over the ${String(seen.at - 1)} ticks before the ` +
        "release — a cue is played on the tick its event happens " +
        "(specs/progression.md)",
    );
    assertEqual(
      cuesOnEvent(seen, CUES.ink),
      1,
      "times CUES.ink played on the tick the forager released its cloud, which " +
        "is its own tick and at most once on it (specs/progression.md)",
    );
  },
);
