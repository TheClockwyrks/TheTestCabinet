// sonar/not-reveal-amber — a pulse never answers which glimmer is which.
//
// specs/sensing.md: "The amber lights are left as they are. A pulse draws neither
// the bonus drifter's body nor the Lanternjaw's, and it changes neither amber
// mote, so a pulse never resolves which glimmer is which."
// specs/predators/lanternjaw.md says the same from the hunter's side: "A sonar
// pulse never resolves that question... a pulse that floods over it leaves the
// bulb exactly as it was and draws no body, marking neither it nor a drifter."
//
// TWO READINGS, because the claim has two halves and a build can hold either
// alone. What the build SAYS — the Lanternjaw's `lit`, which specs/state.md
// defines as "true while its body is being drawn this instant" — must stay
// `false` for the whole life of the pulse. And what the build DRAWS — the amber
// mote on each of the two creatures — must come through the front's passage
// unchanged. A build that marks the Lanternjaw like the other two hunters fails
// the first; one that leaves `lit` alone but tints the mote as the crest goes
// over, or lights the body under it, fails the second.
//
// THE MOTES ARE READ BETWEEN TWO PULSES, and that is what keeps the reading about
// the creatures rather than about the ground they stand on. A pulse is REQUIRED to
// reveal the corridor it floods, so a mote read before any pulse and again
// afterwards sits over fog the first time and over remembered corridor the second
// — a difference the same page asks for, and one wide enough on its own to look
// like a mote that changed. So a first pulse is cast and run out, the two motes
// are read on the board it leaves, a second pulse is cast over the identical
// board, and they are read again. Nothing about the ground moves between the two
// readings, so anything that does is the pulse acting on an amber light.
//
// NEITHER READING IS TAKEN UNDERNEATH THE CREST. specs/sensing.md has the pulse
// drawn as "a glowing crest that flows outward through the corridors" in its own
// cyan overlay, so the crest lies over those tiles for the moment it takes to
// pass them and a reading taken then would be measuring the drawing the same page
// asks for. Each reading is taken once the pulse has run out and left the list,
// while the `SONAR_MARK_TIME` (`1.5 s`) window a mark would have opened is still
// running — so a build that marked either creature is still drawing it when the
// mote is read.
//
// EACH MOTE IS READ AS A PROFILE ABOUT ITS OWN DRAWN CENTRE. Where on a body the
// amber light sits is the build's art, and specs/sensing.md fixes only that it is
// "a single glowing amber point"; `sampleMoteProfile` finds the light and reads
// it across a spread of radii, so the comparison is of the mote with itself
// rather than of one arbitrary pixel with another.
//
// WHAT THIS DOES NOT DECIDE. That the two motes are drawn ALIKE, which is
// `amber/*`'s; and what a pulse does to the hunters it may mark, which is
// `sonar/marks-predators`'.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { poseSonarSense } from "../fixtures";
import {
  captureStill,
  createHarness,
  profileDistance,
  sampleMoteProfile,
  startPlaying,
  type Harness,
  type MoteSample,
} from "../harness";
import {
  clearUnderfoot,
  denAll,
  graded,
  parkForager,
  requirePred,
  requireSceneHeld,
  sceneGuard,
} from "../scene";
import { emitPulse, foragerPulse, sinceEmit } from "./pulse";

/**
 * How far a mote may be drawn from where it was drawn before the pulse, as an
 * RGB distance.
 *
 * The item's bound: `25` of the `441` that separates black from white. Wide
 * enough for a rounding of the fog beneath the light — the tile under each
 * creature does go from never-revealed to remembered as the flood passes, and
 * specs/sensing.md asks for exactly that — and far too narrow for a body drawn
 * under the mote, a tint laid over it, or a mark held on it.
 */
const MOTE_TOLERANCE = 25;

/**
 * How long the sweep runs, in ticks after the press.
 *
 * A hard ceiling half again the `77` ticks a conforming front takes to pass the
 * depth-1 range of `9` steps, so a build that leaves its pulse in flight FAILS
 * here rather than leaving the point undecided.
 */
const SWEEP_TICKS = 120;

/** Ticks run on the posed board before the pulse, so the opening read is settled. */
const SETTLE_TICKS = 2;

/**
 * Ticks run after a pulse leaves the list, before the motes are read.
 *
 * A beat, so what is read is the board the pulse left rather than the tick it
 * left on — and still far inside the `SONAR_MARK_TIME` (`1.5 s`) a mark would
 * have run for.
 */
const AFTER_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the Lanternjaw unlit and both amber motes unchanged through a pulse", async (ctx) => {
  await graded(ctx, async () => {
    await startPlaying(h);
    const targets = await poseSonarSense(h, 2);
    await parkForager(h);
    await clearUnderfoot(h);

    const posed = h.snapshot();
    const lanternjaw = requirePred(posed, "lanternjaw");
    const quiet = await denAll(h, ["lanternjaw"]);

    h.debug.setPredatorTile(lanternjaw, targets[0].tx, targets[0].ty);
    h.debug.setPredatorState(lanternjaw, "wander");
    h.debug.spawnDrifter(targets[1].tx, targets[1].ty);
    // Both held where they were posed, so the two motes are read at the same two
    // points before and after and neither creature acts on the pulse.
    h.debug.setCreatureAI(false);

    const watch = await sceneGuard(h, quiet);

    await h.advance(SETTLE_TICKS);
    const posedBoard = h.snapshot();
    assertEqual(
      posedBoard.drifters.length,
      1,
      "the bonus drifters on the board, one of them posed through spawnDrifter",
    );

    /** Cast a pulse, run it out, and report the Lanternjaw's `lit` throughout. */
    const cast = async (): Promise<{
      spent: boolean;
      lit: { elapsed: number; lit: boolean }[];
    }> => {
      const emitted = await emitPulse(h);
      const lit: { elapsed: number; lit: boolean }[] = [];
      let spent = false;
      for (let tick = 1; tick <= SWEEP_TICKS; tick += 1) {
        if (tick > 1) await h.advance(1);
        const snapshot = h.snapshot();
        lit.push({
          elapsed: sinceEmit(emitted, snapshot),
          lit: snapshot.predators[lanternjaw].lit,
        });
        if (foragerPulse(snapshot) === undefined) {
          spent = true;
          break;
        }
      }
      await h.advance(AFTER_TICKS);
      return { spent, lit };
    };

    /** Both amber lights, each read about its own drawn centre. */
    const motes = (): Record<string, MoteSample[]> => {
      const snapshot = h.snapshot();
      return {
        "Lanternjaw's bulb": sampleMoteProfile(
          h,
          snapshot.predators[lanternjaw].x,
          snapshot.predators[lanternjaw].y,
        ),
        "bonus drifter's mote": sampleMoteProfile(
          h,
          snapshot.drifters[0].x,
          snapshot.drifters[0].y,
        ),
      };
    };

    // The first pulse settles the ground: the corridor both creatures stand on
    // goes from never-revealed to remembered, which is what specs/sensing.md asks
    // a flood to do and is not what this point is about.
    const first = await cast();
    const motesBefore = motes();

    // And the second is the one the claim is read across.
    const second = await cast();
    const motesAfter = motes();
    const after = h.snapshot();
    // Before the assertions, so a failing check still leaves the picture that
    // shows what the pulse did to the two glimmers.
    captureStill(h, "amber");

    requireSceneHeld(after, watch);
    for (const run of [first, second]) {
      assertEqual(
        run.spent,
        true,
        `the pulse ran out within ${SWEEP_TICKS} ticks of the press, so each ` +
          "reading is taken with no crest over the two creatures",
      );
    }

    for (const sample of [...first.lit, ...second.lit]) {
      assertEqual(
        sample.lit,
        false,
        `the Lanternjaw's lit ${sample.elapsed.toFixed(3)} s into the pulse that ` +
          "flooded the tile it stands on",
      );
    }
    assertEqual(
      after.predators[lanternjaw].lit,
      false,
      "the Lanternjaw's lit once the pulse has run out, inside the " +
        "SONAR_MARK_TIME a mark would still be holding it drawn for",
    );

    for (const [what, profile] of Object.entries(motesBefore)) {
      assertLessThanOrEqual(
        profileDistance(profile, motesAfter[what]),
        MOTE_TOLERANCE,
        `the RGB distance between the ${what} before the pulse and after the ` +
          "front had passed over it, of 441",
      );
    }
  });
});
