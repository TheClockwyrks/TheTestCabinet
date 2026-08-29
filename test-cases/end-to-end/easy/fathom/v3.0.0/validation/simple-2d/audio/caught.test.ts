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
// THE CUE IS READ BY NAME. The game asks the runtime's cue bus for a cue by name
// and the bus announces the play (`specs/progression.md`), so what is asserted
// here is the exact name that file fixes, sounding exactly ONCE on the event's own
// tick — which is the "at most once on that tick" half of the requirement — and
// not at all on the ticks before it.
//
// WHAT THIS DOES NOT DECIDE. What a catch costs and what it resets, which is
// `scoring/caught-costs-life`'s; the run ending, which is `scoring/three-lives`'s.

import { afterEach, beforeEach } from "vitest";
import { CUES } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";
import { check, clearUnderfoot, denAll, parkForager } from "../scene";
import { cuesBeforeEvent, cuesOnEvent, watchForEvent } from "./cues";

/**
 * The roster index the catch is staged with.
 *
 * `specs/gameplay.md` costs a life for contact whatever the predator's kind, and
 * `specs/state.md` fixes index `0` as the first of the release order at every
 * depth, so the roster always holds one.
 */
const HUNTER = 0;

/**
 * The frames the catch is given.
 *
 * The hunter's center already lies on the forager's own tile when the watch
 * opens, which is contact as `specs/gameplay.md` defines it, so a conforming
 * build takes the life on the first tick. One second is a hard ceiling on that,
 * so a build that never registers contact fails on the bound rather than leaving
 * the point inconclusive.
 */
const CATCH_TICKS = ticks(1);

/** Frames run past the reading, purely so the clip shows the catch land. */
const TAIL_TICKS = ticks(1);

/**
 * Ticks the watch runs before the hunter is placed, so the quiet it reads is a
 * window rather than nothing.
 *
 * A quarter of a second with every hunter still in the den and the forager
 * parked facing rock. Without it the contact lands on the watch's very first
 * tick, and "nothing sounded before it" would be a reading of no ticks at all.
 */
const QUIET_LEAD = ticks(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

check(
  "plays CUES.caught on the tick a predator makes contact, and not before",
  async () => {
    await startPlaying(h);
    // At depth 1 the roster holds one of each kind (specs/predators.md), so
    // leaving index 0 out leaves exactly that one hunter loose.
    await denAll(h, [HUNTER]);
    await parkForager(h);
    await clearUnderfoot(h);

    const before = h.snapshot();

    const seen = await captureReplay(h, "caught", async () => {
      const found = await watchForEvent(
        h,
        (s) => s.lives < before.lives || s.screen !== "playing",
        QUIET_LEAD + CATCH_TICKS,
        {
          quietLead: QUIET_LEAD,
          // The contact itself: a hunter whose center lies on the forager's own
          // tile (specs/gameplay.md), posed loose so the build's own rule decides.
          arm: () => {
            h.debug.setPredatorTile(
              HUNTER,
              before.forager.tx,
              before.forager.ty,
            );
            h.debug.setPredatorState(HUNTER, "chase");
          },
        },
      );
      // Past the reading, so the clip shows the catch land and the board reset.
      // Nothing after this line can reach an assertion.
      await h.advance(TAIL_TICKS);
      return found;
    });

    assertEqual(
      seen.hit,
      true,
      `the ${before.predators[HUNTER].kind} standing on the forager's own tile ` +
        `made contact inside ${String(CATCH_TICKS)} ticks`,
    );
    assertEqual(
      seen.snapshot.lives,
      before.lives - 1,
      "the lives in reserve after the staged contact, so what the cue is read " +
        "against is a catch (specs/gameplay.md)",
    );
    assertEqual(
      cuesBeforeEvent(seen, CUES.caught),
      0,
      `times CUES.caught played over the ${String(seen.at - 1)} ticks before the ` +
        "contact — a cue is played on the tick its event happens " +
        "(specs/progression.md)",
    );
    assertEqual(
      cuesOnEvent(seen, CUES.caught),
      1,
      "times CUES.caught played on the tick the predator made contact, which is " +
        "its own tick and at most once on it (specs/progression.md)",
    );
  },
);
