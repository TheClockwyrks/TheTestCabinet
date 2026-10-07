// Meltdown — movers/sink-output-scales: the Sink's output rises with the level.
//
// `specs/towers.md` tabulates the Sink's `SINK_OUTPUT` at `16`, `24` and `36` for
// levels I, II and III, and says a mover's level "moves its own output alone".
// `specs/heat.md` puts that output at the head of the drain —
// `output(S) * sharedEdges(T, S) * (H_T / 100)` — so the level is a straight
// multiplier on what the Sink removes.
//
// THREE GUNS, ONE FLOOR, ONE FRAME. Three Arcs at the same `70`, one Sink level
// each, read in the same frame, so the only thing that differs between the three
// readings is the level. The drains are `16 * 2 * 0.70`, `24 * 2 * 0.70` and
// `36 * 2 * 0.70` per second — `0.1867`, `0.28` and `0.42` of a heat point over
// one frame. A build with one output for every level reads the same number three
// times; a build whose levels move it by the wrong steps — doubling, say, for
// `16`, `32`, `64` — reads the level-I figure right and the other two wrong,
// which is why all three are asserted rather than a ratio.
//
// EVERY OTHER FLOW IS POSED OUT OF ALL THREE ARRANGEMENTS: each Arc's other three
// faces carry plain walls at its own heat, which takes the air term to zero and
// leaves conduction at a gradient of zero, and one frame is short enough that no
// wall's own cooling reaches a subject (`movers/contact.ts`).

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { SINK_OUTPUT, TRIP_HEAT, type TowerType } from "../constants";
import {
  captureStill,
  createHarness,
  seconds,
  startRun,
  type Harness,
} from "../harness";
import { sizeOf } from "../thermal";
import { massOf, poseBoxed, readHeat } from "./contact";

/** The three levels `specs/towers.md` gives a tower, in order. */
const LEVELS = [1, 2, 3] as const;

/** The gun read on all three legs, and the heat all three open at. */
const GUN: TowerType = "arc";
const HEAT = 70;

/** A 2x2 face is two edge-tiles, so a flush 2x2 Sink is a contact of two. */
const SHARED_EDGES = sizeOf(GUN);

/** The frame every drain is measured over, in seconds of game time. */
const DT = seconds(1);

/** What one frame of a level-`level` Sink must take off the gun. */
function expectedLoss(level: number): number {
  return (
    (SINK_OUTPUT[level - 1] * SHARED_EDGES * (HEAT / TRIP_HEAT) * DT) /
    massOf(GUN)
  );
}

/**
 * How close each drain must come, as decimal places of a heat point.
 *
 * Three places is `0.0005`, under one percent of the `0.0933` step between the
 * level-I and level-II figures. Each reading is one multiplication over figures
 * the specification states exactly, on a frame whose every other term is
 * identically zero, so a conformant build lands on all three to within float
 * slack.
 */
const HEAT_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The Sink's output rises with the level", async () => {
  await startRun(h);
  const guns = [];
  for (const level of LEVELS) {
    guns.push({
      level,
      boxed: await poseBoxed(
        h,
        { type: GUN, heat: HEAT },
        [{ type: "sink", side: "N", level }],
        level - 1,
      ),
    });
  }

  const opened = [];
  for (const gun of guns) {
    opened.push(
      await readHeat(
        h,
        gun.boxed.id,
        `the ${GUN} beside a level-${gun.level} Sink`,
      ),
    );
  }
  await h.advance(1);
  await captureStill(h, "levels");
  for (const [index, gun] of guns.entries()) {
    const closed = await readHeat(
      h,
      gun.boxed.id,
      `the ${GUN} beside a level-${gun.level} Sink, a frame on`,
    );
    assertCloseTo(
      opened[index] - closed,
      expectedLoss(gun.level),
      HEAT_DIGITS,
      `the heat a level-${gun.level} Sink, whose per-edge output ` +
        `specs/towers.md puts at ${SINK_OUTPUT[gun.level - 1]}, takes off a ` +
        `${GUN} at ${HEAT} over one frame`,
    );
  }
});
