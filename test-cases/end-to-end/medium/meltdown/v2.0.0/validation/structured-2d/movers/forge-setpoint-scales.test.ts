// Meltdown — movers/forge-setpoint-scales: the setpoint rises with the level.
//
// specs/towers.md gives the Forge's setpoint per level as `72`, `84` and `96`, and
// says a mover's level "moves its own output alone". specs/heat.md drives the flow
// as `FORGE_K * sharedEdges * max(0, setpoint - H)`, so the setpoint is not a
// figure a snapshot has to report for the check to reach it: on a COLD gun the
// flow is `FORGE_K * sharedEdges * setpoint`, and dividing the measured flow back
// through `FORGE_K` and the contact reads the setpoint the build actually used.
// That is what this check asserts: the measured flow multiplied through the Arc's
// mass of `1.0` and divided by `FORGE_K * sharedEdges`, which is `1.8`, is the
// setpoint itself — so a build whose per-level table is wrong fails on the number
// the table holds.
//
// THE SECOND CLAUSE IS A CONSEQUENCE OF THE FIRST, AND IT IS THE ONE THAT MATTERS
// IN PLAY. specs/towers.md gives the Lance a redline of `92`, so a level-I Forge on
// `72` and a level-II on `84` have nothing left to give a Lance that has already
// reached it, while a level-III on `96` still has four degrees of push:
// `0.9 * 2 * (96 - 92) / 2.8` — the Lance's mass is `2.8` — which is `2.571…` a
// second.
//
// READ AT A LANCE POSED EXACTLY ON ITS REDLINE, the first two levels must therefore
// ADD NOTHING and the third must add that figure. The first two are asserted as a
// ceiling rather than as an equality on purpose: whether a Forge whose setpoint sits
// below a gun's heat leaves it alone or actively cools it is the clamp, which is
// `movers/forge-caps-at-its-setpoint`'s item, and this one should not fail twice for
// it. What the ceiling does exclude is a build that shipped one setpoint for all
// three levels: if that setpoint is above `92` the first two levels push where they
// must not, and if it is at or below `92` the third adds nothing where it must.
//
// WHY THE READING IS A DIFFERENCE. The Lance at `92` sheds hard, and the face the
// Forge stands against is a face taken out of the air term, so `bench.ts` poses
// each floor twice and subtracts a control with an inert wall in the Forge's place.
// The note at the head of that file states the whole of it.

import { afterEach, beforeEach, it } from "vitest";
import { FORGE_K, FORGE_SETPOINT } from "../constants";
import { assertCloseTo, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  type Face,
  type Harness,
} from "../harness";
import {
  faceAnchor,
  massOf,
  moverFlow,
  redlineOf,
  type Neighbour,
} from "./bench";

/** The three levels, and the face the Forge stands against. */
const LEVELS = [1, 2, 3] as const;
const FACE: Face = "N";

/** The cold gun the setpoint itself is read off. */
const COLD_SUBJECT = "arc";
const COLD = 0;

/** The gun the redline clause is read on, posed exactly on its redline. */
const REDLINE_SUBJECT = "lance";
const LANCE_REDLINE = redlineOf(REDLINE_SUBJECT);

/**
 * Edge-tiles the contact runs along: a 2x2 Forge covers two edge-tiles of the
 * face it stands against, whatever the size of that footprint (specs/heat.md).
 */
const SHARED_EDGES = 2;

/** What the level-III Forge still has left at the Lance's redline, per second. */
const PUSH_AT_REDLINE =
  (FORGE_K * SHARED_EDGES * (FORGE_SETPOINT[2] - LANCE_REDLINE)) /
  massOf(REDLINE_SUBJECT);

/**
 * The most a level I or II Forge may add at the Lance's redline: nothing.
 *
 * A ceiling rather than an equality — see the head of this file — set at the same
 * `0.05` of a heat point per second the readings below are held to, so a
 * conformant build reading exactly zero is not failed by floating-point noise. The
 * level-III push it has to be told apart from is `2.571…`, fifty times it.
 */
const NO_PUSH_CEILING = 0.05;

/**
 * How close each reading must come.
 *
 * `SETPOINT_DIGITS` is one decimal place of a SETPOINT, `0.05` of a heat point on
 * a scale whose three rungs are twelve points apart — a bound two hundred times
 * smaller than the gap between one level's setpoint and the next.
 * `FLOW_DIGITS` is one decimal place of heat per second on the redline reading,
 * `0.05` against a required `2.571…`, which is itself the whole of the distance
 * between a build that scales its setpoint and one that does not.
 */
const SETPOINT_DIGITS = 1;
const FLOW_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The setpoint rises with the level", async () => {
  const cold: number[] = [];
  for (const level of LEVELS) {
    const forge: Neighbour = {
      type: "forge",
      level,
      ...faceAnchor(COLD_SUBJECT, FACE),
    };
    cold.push(await moverFlow(h, { type: COLD_SUBJECT, heat: COLD }, [forge]));
  }

  const redline: number[] = [];
  for (const level of LEVELS) {
    const forge: Neighbour = {
      type: "forge",
      level,
      ...faceAnchor(REDLINE_SUBJECT, FACE),
    };
    redline.push(
      await moverFlow(h, { type: REDLINE_SUBJECT, heat: LANCE_REDLINE }, [
        forge,
      ]),
    );
  }
  captureStill(h, "levels");

  LEVELS.forEach((level, i) => {
    assertCloseTo(
      (cold[i] * massOf(COLD_SUBJECT)) / (FORGE_K * SHARED_EDGES) + COLD,
      FORGE_SETPOINT[level - 1],
      SETPOINT_DIGITS,
      `the setpoint a level-${level} Forge drove a cold ${COLD_SUBJECT} toward, ` +
        `read back out of the flow it applied`,
    );
  });

  LEVELS.forEach((level, i) => {
    const context =
      `heat per second a level-${level} Forge drives into a ${REDLINE_SUBJECT} ` +
      `sitting on its ${LANCE_REDLINE} redline`;
    if (level === LEVELS[LEVELS.length - 1]) {
      assertCloseTo(redline[i], PUSH_AT_REDLINE, FLOW_DIGITS, context);
    } else {
      assertLessThanOrEqual(redline[i], NO_PUSH_CEILING, context);
    }
  });
});
