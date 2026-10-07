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
// alone. What the build SAYS — the `lit` flag of each amber creature, which
// specs/state.md defines for the bonus drifter and for the Lanternjaw alike as
// true "while its body is being drawn this instant" — must stay `false` for the
// whole life of the pulse. And what the build DRAWS — the amber mote on each of
// the two creatures — must come through the front's passage unchanged. A build
// that marks either creature the way it marks the other two hunters fails the
// first; one that leaves both flags alone and tints a mote as the crest goes
// over fails the second.
//
// THE DRIFTER IS READ THROUGH ITS OWN FLAG. Its amber mote is drawn under the
// amber-light rule rather than under the fog, so the mote is on screen whether or
// not the jellyfish beneath it is, and the ground both creatures stand on goes
// from never-revealed to remembered as a pulse passes, which is a change of its
// own and one specs/sensing.md asks for. `lit` puts the question to the build
// directly instead, so a build that begins drawing a drifter's body once a pulse
// has flooded the tile it stands on answers `true` where specs/state.md requires
// `false`.
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
import { poseSonarSense, spawnDrifter, spawnPredator } from "../fixtures";
import {
  captureStill,
  createHarness,
  profileDistance,
  sampleMoteProfile,
  type Harness,
  type MoteSample,
  startPlaying,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import { emitPulse, foragerPulse, sinceEmit } from "./pulse";

/** One tick's reading of one amber creature's `lit` flag. */
interface LitSample {
  /** Seconds since the pulse was emitted. */
  elapsed: number;
  /** Whose flag it is, so a failure names the creature the pulse drew. */
  whose: string;
  lit: boolean;
}

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

afterEach(async () => {
  await h.dispose();
});

it("leaves both amber creatures unlit and both motes unchanged through a pulse", async () => {
  await startPlaying(h);
  const targets = await poseSonarSense(h, 2);
  await parkForager(h);

  // The two amber lights this point reads, each on a tile the pulse floods to.
  // Both are held where they were posed, so the two motes are read at the same
  // two points before and after and neither creature acts on the pulse.
  const lanternjaw = await spawnPredator(h, "lanternjaw", targets[0], {
    state: "wander",
    mind: false,
  });
  await spawnDrifter(h, targets[1], { mind: false });

  const watch = await sceneGuard(h);

  await h.advance(SETTLE_TICKS);
  const posedBoard = await h.snapshot();
  assertEqual(
    posedBoard.drifters.length,
    1,
    "the bonus drifters on the board, one of them posed through spawnDrifter",
  );

  /**
   * Cast a pulse, run it out, and report both amber creatures' `lit`
   * throughout.
   *
   * `lost` records a drifter that left the list under the reading, because a
   * board with no drifter on it answers the drifter's half of the claim
   * neither way.
   */
  const cast = async (): Promise<{
    spent: boolean;
    lost: boolean;
    lit: LitSample[];
  }> => {
    const emitted = await emitPulse(h);
    const lit: LitSample[] = [];
    let spent = false;
    let lost = false;
    for (let tick = 1; tick <= SWEEP_TICKS; tick += 1) {
      if (tick > 1) await h.advance(1);
      const snapshot = await h.snapshot();
      const drifter = snapshot.drifters[0];
      if (drifter === undefined) {
        lost = true;
        break;
      }
      const elapsed = sinceEmit(emitted, snapshot);
      lit.push(
        {
          elapsed,
          whose: "Lanternjaw's",
          lit: snapshot.predators[lanternjaw].lit,
        },
        { elapsed, whose: "bonus drifter's", lit: drifter.lit },
      );
      if (foragerPulse(snapshot) === undefined) {
        spent = true;
        break;
      }
    }
    await h.advance(AFTER_TICKS);
    return { spent, lost, lit };
  };

  /** Both amber lights, each read about its own drawn centre. */
  const motes = async (): Promise<Record<string, MoteSample[]>> => {
    const snapshot = await h.snapshot();
    return {
      "Lanternjaw's bulb": await sampleMoteProfile(
        h,
        snapshot.predators[lanternjaw].x,
        snapshot.predators[lanternjaw].y,
      ),
      "bonus drifter's mote": await sampleMoteProfile(
        h,
        snapshot.drifters[0].x,
        snapshot.drifters[0].y,
      ),
    };
  };

  // Both amber creatures have to be undrawn BEFORE any pulse is cast, or "the
  // pulse left them unlit" reads the same on a build whose own light was
  // already drawing them. This fixture stands both behind rock, so a build
  // that draws either one here has light that does not stop at rock.
  for (const [whose, drawn] of [
    ["Lanternjaw's", posedBoard.predators[lanternjaw].lit],
    ["bonus drifter's", posedBoard.drifters[0].lit],
  ] as const) {
    assertEqual(
      drawn,
      false,
      `the ${whose} body drawn before any pulse was cast — both stand behind ` +
        "rock and specs/sensing.md has the light travel straight and stop at " +
        "the rock it lands on, so an undrawn pair is what makes what the pulse " +
        "then does the pulse's own doing",
    );
  }

  // The first pulse settles the ground: the corridor both creatures stand on
  // goes from never-revealed to remembered, which is what specs/sensing.md asks
  // a flood to do and is not what this point is about.
  const first = await cast();
  const motesBefore = await motes();

  // And the second is the one the claim is read across.
  const second = await cast();
  const motesAfter = await motes();
  const after = await h.snapshot();
  // Before the assertions, so a failing check still leaves the picture that
  // shows what the pulse did to the two glimmers.
  await captureStill(h, "amber");

  requireSceneHeld(after, watch);
  for (const run of [first, second]) {
    assertEqual(
      run.lost,
      false,
      "the bonus drifter stayed on the board for the whole pulse, so its " +
        "`lit` could be read across the front's arrival",
    );
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
      `the ${sample.whose} lit ${sample.elapsed.toFixed(3)} s into the pulse ` +
        "that flooded the tile it stands on",
    );
  }
  assertEqual(
    after.predators[lanternjaw].lit,
    false,
    "the Lanternjaw's lit once the pulse has run out, inside the " +
      "SONAR_MARK_TIME a mark would still be holding it drawn for",
  );
  assertEqual(
    after.drifters[0].lit,
    false,
    "the bonus drifter's lit once the pulse has run out, inside the " +
      "SONAR_MARK_TIME a mark would still be holding a marked creature " +
      "drawn for",
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
