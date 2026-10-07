// modes/difficulty-changes-nothing-else — a difficulty changes the starting money
// and the wave count, and NOTHING else.
//
// THE RULE. specs/modes.md, Containment: "A difficulty changes the starting money
// and the wave count, and nothing else. The starting lives are `20` at all three,
// interest is paid at all three, the whole floor is buildable at all three, and
// the per-wave hp scaling is the same at all three." Its table says the same in
// figures: all three Containment rows read `20` lives, `yes` interest, `yes` build
// phases and "The whole floor" for the build zone.
//
// FOUR READINGS, ONE PER CLAUSE, TAKEN AT EACH OF THE THREE DIFFICULTIES.
// `startLives`, `interest` and `buildZone` are derived fields the snapshot reports
// directly (specs/instrumentation.md). The hp scaling is not a field, so it is read
// where specs/instrumentation.md exposes it: `addUnit`'s unit takes a `maxHp` that
// is "its base hp scaled for the current wave", so one Mote added on the same wave
// under each difficulty carries the same `maxHp` exactly when the scaling is the
// same at all three.
//
// THE WAVE THE SCALING IS READ AT IS FIVE, AND THAT IS THE POINT OF IT.
// specs/waves.md's `hpScale(w) = 1 + 0.62 * (w - 1)` is `1` on Wave 1 whatever
// factor a build multiplied into it, so a reading taken there could not tell a
// difficulty-dependent scaling from none at all. On Wave 5 the specified scaling is
// `3.48`, and a build that folded the difficulty into it — an easier run scaling
// more gently, a harder one more steeply — reads three DIFFERENT figures where this
// point requires one. Wave 5 exists in all three runs (the shortest is 15 waves)
// and is not a milestone wave in any of them, so nothing about the wave itself
// differs between the legs.
//
// THE COMPARISON IS BETWEEN THE THREE LEGS, NOT AGAINST A FIGURE. What the specified
// scaling actually pays on Wave 5 is `surge.hp-scales-with-the-wave`'s requirement;
// this point requires only that the three difficulties agree, so a build whose
// scaling is uniformly wrong fails that item and passes this one, and a build whose
// scaling varies by difficulty fails this one. Each item then names one defect.
//
// THE LIVES, THE INTEREST AND THE ZONE ARE READ AGAINST FIGURES, because the
// specification states them outright for all three rows: `START_LIVES` (`20`), paid,
// and the whole floor — which is `buildZone` `null`, the snapshot's spelling of "no
// zone" (surface.ts: "Inclusive on both ends; `null` off Bottleneck").
//
// EACH LEG IS POSED FROM A RESET, so no leg stands on what the leg before it left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { START_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  poseWalker,
  unitOf,
  type DifficultyName,
  type Harness,
} from "../harness";
import { drawOpening, poseMode } from "./run";

/** The mode this point is about: the only one with a difficulty at all. */
const MODE = "containment";

/** The three difficulties, in the order specs/modes.md lists them. */
const DIFFICULTIES: readonly DifficultyName[] = ["easy", "medium", "hard"];

/**
 * The wave the hp scaling is read at.
 *
 * Past Wave 1, where every scaling reads the same; inside the shortest run of the
 * three (Easy's 15 waves); and a milestone wave in none of them
 * (`round(15 / 2)` is `8`, `round(20 / 2)` is `10`, `round(26 / 2)` is `13`).
 */
const WAVE = 5;

/** The type added to read the scaling: the ordinary walker of specs/surge.md. */
const UNIT = "mote";

/** What one leg read. */
interface Leg {
  startLives: number;
  interest: boolean;
  buildZone: unknown;
  maxHp: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Pose Containment at `difficulty` and read the four figures off it. */
function read(difficulty: DifficultyName): Leg {
  poseMode(h, MODE, difficulty);
  const derived = h.snapshot();
  h.debug.setWave(WAVE);
  const id = poseWalker(h, UNIT, "left");
  return {
    startLives: derived.startLives,
    interest: derived.interest,
    buildZone: derived.buildZone,
    maxHp: unitOf(h.snapshot(), id).maxHp,
  };
}

it("leaves the lives, the interest, the build zone and the hp scaling alone at all three difficulties", async () => {
  const legs = DIFFICULTIES.map((difficulty) => read(difficulty));

  poseMode(h, MODE, "medium");
  await drawOpening(h);
  captureStill(h, "unchanged");

  DIFFICULTIES.forEach((difficulty, index) => {
    const leg = legs[index];
    assertEqual(
      leg.startLives,
      START_LIVES,
      `the startLives Containment on ${difficulty} derives (specs/modes.md, Containment)`,
    );
    assertEqual(
      leg.interest,
      true,
      `whether Containment on ${difficulty} pays interest (specs/modes.md, Containment)`,
    );
    assertNull(
      leg.buildZone,
      `the buildZone Containment on ${difficulty} derives, the whole floor being ` +
        "no zone at all (specs/modes.md, Containment)",
    );
  });

  const first = legs[0];
  DIFFICULTIES.forEach((difficulty, index) => {
    assertEqual(
      legs[index].maxHp,
      first.maxHp,
      `the maxHp a ${UNIT} added on wave ${WAVE} carries on ${difficulty}, ` +
        `against the ${first.maxHp} it carries on ${DIFFICULTIES[0]} ` +
        "(specs/modes.md, Containment)",
    );
  });
});
