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
// WHAT THIS ENGINE CANNOT SEE. The cue's NAME, and how many sources one cue is
// made of. `validation/audio/cues.ts` states why, and what these checks assert
// instead.
//
// WHAT THIS DOES NOT DECIDE. What the cloud does to a hunter, which the
// `lanternjaw/*`, `gloamfin/*` and `flarefish/*` points own; how long it stands,
// which is `ink/cloud`'s; the cooldown it starts, which is `ink/cooldown`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { BINDINGS, ticksFor } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import {
  denAllExcept,
  quietBoard,
  requireSceneHeld,
  sceneGuard,
  startPlaying,
} from "../scene";
import { soundsBeforeEvent, soundsOnEvent, watchForEvent } from "./cues";

/** The key `specs/movement.md` binds the `b` action to first: it releases ink. */
const INK_KEY = BINDINGS.b[0];

/**
 * The ticks the key is held for.
 *
 * The press is delivered before the first tick of the watch, and live play reads
 * `b` once per press (`specs/movement.md`), so a conforming build releases on that
 * first tick. Half a second is a hard ceiling sixty times that, so a build that
 * never releases fails on the bound rather than leaving the point inconclusive.
 */
const RELEASE_TICKS = ticksFor(0.5);

/** Ticks run past the reading, purely so the clip shows the cloud standing. */
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

it("sounds on the tick the forager releases ink, and not before", async () => {
  // A real, browser-trusted gesture first: an engineless build owns its own audio
  // layer and is entitled to open it on the player's first interaction alone
  // (`specs/progression.md`). The key is bound to nothing, so this changes no state.
  await h.armAudio();
  await startPlaying(h);
  const quiet = await denAllExcept(h);
  await quietBoard(h);
  await h.debug.setInkCooldown(0);
  const guard = await sceneGuard(h, quiet);

  const watch = await captureReplay(h, "ink", async () => {
    try {
      const seen = await watchForEvent(
        h,
        (s) => s.inkClouds.length > 0,
        QUIET_LEAD + RELEASE_TICKS,
        {
          quietLead: QUIET_LEAD,
          arm: async () => {
            await h.hold(INK_KEY);
          },
        },
      );
      // Held on past the reading, so the clip shows the cloud standing. Nothing
      // after this line can reach an assertion.
      await h.advance(TAIL_TICKS);
      return seen;
    } finally {
      await h.release(INK_KEY);
    }
  });

  requireSceneHeld(h, await h.snapshot(), guard);

  assertEqual(
    watch.hit,
    true,
    `an ink cloud stood on the board inside the ${String(RELEASE_TICKS)} ticks ` +
      "the check holds Shift for, with the cooldown posed ready",
  );
  assertEqual(
    soundsBeforeEvent(watch),
    0,
    `sounds the build emitted over the ${String(watch.at - 1)} ticks before the ` +
      "release, on a board where nothing else is happening — a cue is played on " +
      "the tick its event happens (specs/progression.md)",
  );
  assertGreaterThanOrEqual(
    soundsOnEvent(watch),
    1,
    "sounds the build emitted on the tick the forager released its cloud, which " +
      "is the tick CUES.ink is played on (specs/progression.md)",
  );
});
