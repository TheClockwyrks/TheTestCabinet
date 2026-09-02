// sonar/marks-predators — the front shows the two hunters it can show, and shows
// them for exactly as long as the mark lasts.
//
// specs/sensing.md: "Marks. A predator standing on a flooded tile as the front
// reaches it is marked: its body is drawn at its live position for
// `SONAR_MARK_TIME` (`1.5 s`) from that moment, fading out, whether or not the
// forager's light reaches it. A pulse marks the Gloamfin and the Flarefish."
// specs/state.md: "`lit` is `true` while its body is being drawn this instant,
// whether by the forager's light, a sonar mark, a flare, or its own alert."
//
// So the reading is `lit` across the whole window, and the claim has a beginning,
// a length and an end. A build that never marks fails at the arrival; one that
// marks forever fails at the end; one that flashes the body for a frame fails the
// length. The two hunters are read SEPARATELY, on tiles a step apart, because a
// build that marks one kind and not the other is a different fault from one that
// marks neither.
//
// THE PAIR STANDS WHERE THE LIGHT CANNOT REACH. `poseSonarSense` lays a dog-leg
// whose return leg sits under the outward one with a band of rock between, so the
// corridor joins the two in a few steps while every straight line between them
// crosses rock — and specs/sensing.md has the light travel straight and stop at
// the rock it lands on. `lit` is therefore `false` before the pulse, which the
// check confirms, and anything that turns it `true` afterwards is the mark.
//
// THE TWO HUNTERS ARE THE ONLY BODIES, AND BOTH MINDS ARE OFF. `poseSonarSense`
// clears the roster, the drifters and the plankton, and this check spawns back the
// two it marks. `setPredatorMind(index, false)` "holds exactly where it stands...
// it senses nothing, decides nothing, and does not move" while the wavefront
// travels on (specs/instrumentation.md). That is what keeps the reading about the
// mark: a
// Flarefish left to itself blooms, and a bloom draws its own body, so `lit` would
// stop being a statement about sonar at all.
//
// WHAT THIS DOES NOT DECIDE. The Lanternjaw, which a pulse leaves alone and which
// `sonar/not-reveal-amber` owns; and what a heard pulse does to a Gloamfin's
// state, which is `sonar/heard-by-gloamfin`'s — with the minds off nothing here
// takes a fix.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { SONAR_MARK_TIME, SONAR_WAVE_SPEED, TICK_HZ } from "../constants";
import { poseSonarSense, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { PredatorKind } from "../surface";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import { emitPulse, sinceEmit } from "./pulse";

/**
 * How far the mark's length may sit from `SONAR_MARK_TIME`, in seconds.
 *
 * The item's bound: a tenth of a second. Both ends of the window are read to the
 * tick, so this is slack for a build that runs the mark's own timer down inside
 * its step in a different order from the reference's, and nothing wider.
 */
const LENGTH_TOLERANCE = 0.1;

/**
 * How far the mark's beginning may sit from `d / SONAR_WAVE_SPEED`, in seconds.
 *
 * Deliberately loose, at fifteen hundredths. What this point decides is that the
 * mark begins when the FRONT arrives rather than when the pulse was cast — the
 * two are a quarter of a second apart on this fixture — and how precisely the
 * front keeps to `SONAR_WAVE_SPEED` is `sonar/wavefront`'s verdict, which a
 * tighter bound here would take twice.
 */
const ARRIVAL_TOLERANCE = 0.15;

/**
 * How long the sweep runs, in ticks after the press.
 *
 * A hard ceiling: the furthest of the two tiles is reached `5 / 14` seconds in
 * and its mark ends `SONAR_MARK_TIME` after that, which is `223` ticks, so a
 * build whose mark merely overruns FAILS on the length above rather than leaving
 * the point undecided.
 */
const SWEEP_TICKS = Math.round(
  (5 / SONAR_WAVE_SPEED + SONAR_MARK_TIME + 0.3) * TICK_HZ,
);

/** Ticks run on the posed board before the pulse, so the opening read is settled. */
const SETTLE_TICKS = 2;

/** One hunter's mark, as the sweep saw it. */
interface Mark {
  kind: PredatorKind;
  index: number;
  steps: number;
  litBefore: boolean;
  on: number | null;
  off: number | null;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("marks a Gloamfin and a Flarefish from the front's arrival and holds each for SONAR_MARK_TIME", async () => {
  await startPlaying(h);
  const targets = await poseSonarSense(h, 2);
  await parkForager(h);

  // The two hunters this point marks, each on a target tile of its own and
  // held exactly where it is put and blind, so `lit` can only be the mark. See
  // the header.
  const subjects: { kind: PredatorKind; steps: number }[] = [
    { kind: "gloamfin", steps: targets[0].steps },
    { kind: "flarefish", steps: targets[1].steps },
  ];
  const marks: Mark[] = [];
  for (const [order, subject] of subjects.entries()) {
    const index = await spawnPredator(h, subject.kind, targets[order], {
      state: "wander",
      mind: false,
    });
    marks.push({ ...subject, index, litBefore: true, on: null, off: null });
  }

  const watch = await sceneGuard(h);

  await h.advance(SETTLE_TICKS);
  const before = h.snapshot();
  for (const mark of marks) {
    mark.litBefore = before.predators[mark.index].lit;
  }

  await captureReplay(h, "mark", async () => {
    const emitted = await emitPulse(h);
    for (let tick = 1; tick <= SWEEP_TICKS; tick += 1) {
      if (tick > 1) await h.advance(1);
      const snapshot = h.snapshot();
      const elapsed = sinceEmit(emitted, snapshot);
      for (const mark of marks) {
        const lit = snapshot.predators[mark.index].lit;
        if (mark.on === null && lit) mark.on = elapsed;
        if (mark.on !== null && mark.off === null && !lit) mark.off = elapsed;
      }
      if (marks.every((mark) => mark.off !== null)) break;
    }
  });

  requireSceneHeld(h.snapshot(), watch);

  for (const mark of marks) {
    const arrival = mark.steps / SONAR_WAVE_SPEED;
    assertEqual(
      mark.litBefore,
      false,
      `the ${mark.kind}'s lit before any pulse, standing ${mark.steps} corridor ` +
        "steps out with a band of rock on every line to the forager",
    );
    assertEqual(
      mark.on !== null,
      true,
      `the ${mark.kind} was marked within ${SWEEP_TICKS} ticks of the press, ` +
        `of the ${arrival.toFixed(3)} s a front at SONAR_WAVE_SPEED takes to ` +
        `reach the tile ${mark.steps} steps out it stands on`,
    );
    if (mark.on === null) continue;
    assertLessThanOrEqual(
      Math.abs(mark.on - arrival),
      ARRIVAL_TOLERANCE,
      `|the ${mark.kind}'s mark beginning - ${arrival.toFixed(3)} s|, the ` +
        "moment the front reaches the tile it stands on",
    );
    assertEqual(
      mark.off !== null,
      true,
      `the ${mark.kind}'s mark ended within ${SWEEP_TICKS} ticks of the press, ` +
        `of the ${SONAR_MARK_TIME} s SONAR_MARK_TIME allows it`,
    );
    if (mark.off === null) continue;
    assertLessThanOrEqual(
      Math.abs(mark.off - mark.on - SONAR_MARK_TIME),
      LENGTH_TOLERANCE,
      `|the ${mark.kind}'s mark - SONAR_MARK_TIME|, from the tick its lit ` +
        "turned true to the tick it turned back false",
    );
  }
});
