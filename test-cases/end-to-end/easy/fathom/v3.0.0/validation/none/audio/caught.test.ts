// audio/caught — the caught cue.
//
// `specs/progression.md` fixes `CUES.caught` (`"caught"`) as the cue played when
// "a predator makes contact with the forager", and governs all seven with one
// sentence: "Each is played on the tick its event happens, and at most once on
// that tick."
//
// THE CONTACT IS REAL. `specs/gameplay.md`: "The forager is in contact with a
// predator whose center lies on the forager's own tile, whatever that predator's
// kind and whatever it is doing." So the roster's first hunter is placed on the
// forager's own tile and posed into `"chase"`, and the build's own contact rule
// decides the rest. Nothing here poses a life away.
//
// THE RUN STILL HAS LIVES IN RESERVE, deliberately. A dive opens with
// `START_LIVES` (`3`), so the catch this reads costs a life and sets the board up
// again rather than ending the run — which keeps this point clear of the
// game-over handling `states/gameover` owns.
//
// NO SCENE GUARD HERE. A guard's whole job is to notice a life lost
// mid-measurement; the life lost IS this point's event, so the guard would report
// the subject as the upset. Everything a guard would have watched is instead
// posed still: every other hunter is in the den and the forager is parked facing
// rock.
//
// WHAT THIS ENGINE CANNOT SEE. The cue's NAME, and how many sources one cue is
// made of. `validation/audio/cues.ts` states why, and what these checks assert
// instead.
//
// WHAT THIS DOES NOT DECIDE. What a catch costs and what it resets, which is
// `scoring/caught-costs-life`'s; the run ending, which is `scoring/three-lives`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { ticksFor } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { denAllExcept, quietBoard, startPlaying } from "../scene";
import { soundsBeforeEvent, soundsOnEvent, watchForEvent } from "./cues";

/**
 * The roster index the catch is staged with.
 *
 * `specs/gameplay.md` costs a life for contact whatever the predator's kind, and
 * `specs/state.md` fixes index `0` as the first of the release order at every
 * depth, so the roster always holds one.
 */
const HUNTER = 0;

/**
 * The ticks the catch is given, in ticks.
 *
 * The hunter's center already lies on the forager's own tile when the watch
 * opens, which is contact as `specs/gameplay.md` defines it, so a conforming
 * build takes the life on the first tick. One second is a hard ceiling on that,
 * so a build that never registers contact fails on the bound rather than leaving
 * the point inconclusive.
 */
const CATCH_TICKS = ticksFor(1);

/** Ticks run past the reading, purely so the clip shows the catch land. */
const TAIL_TICKS = ticksFor(1);

/**
 * Ticks the watch runs before the hunter is placed, so the quiet it reads is a
 * window rather than nothing.
 *
 * A quarter of a second with every hunter still in the den and the forager
 * parked facing rock. Without it the contact lands on the watch's very first
 * tick, and "nothing sounded before it" would be a reading of no ticks at all.
 */
const QUIET_LEAD = ticksFor(0.25);

let h: Harness;

beforeEach(async (ctx) => {
  h = await createHarness(ctx);
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the tick a predator makes contact, and not before", async () => {
  // A real, browser-trusted gesture first: an engineless build owns its own audio
  // layer and is entitled to open it on the player's first interaction alone
  // (`specs/progression.md`). The key is bound to nothing, so this changes no state.
  await h.armAudio();
  await startPlaying(h);
  await denAllExcept(h, [HUNTER]);
  await quietBoard(h);

  const before = await h.snapshot();

  const watch = await captureReplay(h, "caught", async () => {
    const seen = await watchForEvent(
      h,
      (s) => s.lives < before.lives || s.screen !== "playing",
      QUIET_LEAD + CATCH_TICKS,
      {
        quietLead: QUIET_LEAD,
        // The contact itself: a hunter whose center lies on the forager's own
        // tile (specs/gameplay.md), posed loose so the build's own rule decides.
        arm: async () => {
          await h.debug.setPredatorTile(
            HUNTER,
            before.forager.tx,
            before.forager.ty,
          );
          await h.debug.setPredatorState(HUNTER, "chase");
        },
      },
    );
    // Past the reading, so the clip shows the catch land and the board reset.
    // Nothing after this line can reach an assertion.
    await h.advance(TAIL_TICKS);
    return seen;
  });

  assertEqual(
    watch.hit,
    true,
    `the ${before.predators[HUNTER]?.kind ?? "hunter"} standing on the ` +
      `forager's own tile made contact inside ${String(CATCH_TICKS)} ticks`,
  );
  assertEqual(
    watch.snapshot.lives,
    before.lives - 1,
    "the lives in reserve after the staged contact, so what the cue is read " +
      "against is a catch (specs/gameplay.md)",
  );
  assertEqual(
    soundsBeforeEvent(watch),
    0,
    `sounds the build emitted over the ${String(watch.at - 1)} ticks before the ` +
      "contact, on a board where nothing else is happening — a cue is played on " +
      "the tick its event happens (specs/progression.md)",
  );
  assertGreaterThanOrEqual(
    soundsOnEvent(watch),
    1,
    "sounds the build emitted on the tick the predator made contact, which is " +
      "the tick CUES.caught is played on (specs/progression.md)",
  );
});
