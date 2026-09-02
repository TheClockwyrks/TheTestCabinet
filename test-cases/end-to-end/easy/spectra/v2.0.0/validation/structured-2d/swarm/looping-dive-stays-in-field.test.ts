// swarm/looping-dive-stays-in-field — a dive that loops back turns above the
// field's floor.
//
// specs/swarm.md, "The dive": a dive "ends either by turning back above
// `FIELD_BOTTOM` without ever entering the bottom HUD strip, or by wrapping
// through the bottom as above". specs/field.md puts that strip at `y` in
// `[HUD_BOTTOM_TOP, STAGE_H]` (`[656, 720]`) and the play field's floor at the
// same edge, so the two halves of the sentence are one reading: a LOOPING dive's
// centre never reaches `FIELD_BOTTOM`.
//
// THE RULE IS CONDITIONAL, AND THIS CHECK KEEPS IT THAT WAY. Which of the two
// endings a dive takes is the build's own choice, drawn from its own generator,
// and a build whose dives all wrap breaks nothing. So several dives are flown,
// each is classified by what it DID — a dive holding a bottom-to-top jump wrapped;
// one holding none looped — and the assertion is made of the looping ones alone.
// A wrapping dive is not held to a floor it is entitled to pass through.
//
// WHY A JUMP IS WHAT TELLS THE TWO APART. The wrap is the one discontinuity a
// dive may hold (`swarm/dive-continuous` grades that), and it is enormous: the
// drone crosses most of the field's height in one frame. Twice one frame's dive
// travel separates it from any step a build could fly, for the reason
// `swarm/dive-continuous` states.
//
// The dives are posed high in the field, because a dive posed near the bottom has
// no room to loop and a build is entitled to wrap it; from up here both endings
// are open. Each drone dives with travel on and firing off, and `startPosed` shuts
// the wave's entry and dive gates, so nothing joins the field and nothing else is
// launched while a dive is flown.

import { afterEach, beforeEach, it } from "vitest";
import {
  DIVE_SPEED,
  FIELD_BOTTOM,
  FIELD_TOP,
  FORM_CENTER_X,
  droneSpeedScale,
} from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseDrone,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { deepest, step, steps, traceDrone, type Sample } from "./flight";

/** The stage the dives are posed at: the first, where droneSpeedScale is 1. */
const STAGE = 1;

/** One frame's dive travel at that stage, and the step that is a wrap. */
const FRAME_TRAVEL = DIVE_SPEED * droneSpeedScale(STAGE) * seconds(1);
const MAX_STEP = 2 * FRAME_TRAVEL;

/** The whole span a dive may occupy (`specs/swarm.md`), in frames. */
const DIVE_FRAMES = ticksFor(8);

/**
 * The dives flown.
 *
 * A build draws each dive's ending from its own generator, so a handful of dives
 * is what it takes to see a looping one at all. Every looping dive among them is
 * held to the floor; the wrapping ones are left alone.
 */
const DIVES = 6;

/**
 * How far the drone's `y` must fall back from the deepest it reached before the
 * dive counts as having TURNED, in logical units.
 *
 * Framing for the captured picture and nothing else — no verdict rests on it. It
 * is more than two frames of dive travel, so a still is taken on a path that has
 * really reversed rather than on one flattening out.
 */
const TURN_DROP = 3 * FRAME_TRAVEL;

/** Where each dive is posed: high in the field, on the grid's centre column. */
const AT = { x: FORM_CENTER_X, y: FIELD_TOP + 76 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns a looping dive back above FIELD_BOTTOM, clear of the bottom HUD strip", async () => {
  startPosed(h);

  let captured = false;
  const looped: { attempt: number; deepest: number }[] = [];

  for (let attempt = 0; attempt < DIVES; attempt += 1) {
    h.debug.clearDrones();
    const id = poseDrone(h, "shard", AT.x, AT.y, {
      phase: "diving",
      travel: true,
    });

    // Flown in two halves so the still can be taken AT the turn: the first stops
    // when the path reverses, the second carries the dive to its end.
    let low = Number.NEGATIVE_INFINITY;
    let turned = false;
    const toTurn = await traceDrone(h, id, {
      frames: DIVE_FRAMES,
      stop: (sample, taken) => {
        if (sample.phase !== "diving") return true;
        if (sample.y > low) {
          low = sample.y;
          return false;
        }
        const previous = taken[taken.length - 2];
        if (previous === undefined) return false;
        if (step(previous, sample) > MAX_STEP) return false;
        turned = sample.y < low - TURN_DROP;
        return turned;
      },
    });
    if (turned && !captured) {
      captureStill(h, "turned");
      captured = true;
    }
    const rest = await traceDrone(h, id, {
      frames: Math.max(1, DIVE_FRAMES - toTurn.samples.length),
      stop: (sample) => sample.phase !== "diving",
    });

    const flown: Sample[] = [...toTurn.samples, ...rest.samples];
    const wrapped = steps(flown).some((travelled) => travelled > MAX_STEP);
    if (wrapped) continue;
    looped.push({ attempt, deepest: deepest(flown) });
  }

  if (!captured) captureStill(h, "turned");

  for (const dive of looped) {
    assertLessThanOrEqual(
      dive.deepest,
      FIELD_BOTTOM,
      `the deepest y dive ${dive.attempt + 1} of ${DIVES} reached, having ` +
        `ended by looping back rather than wrapping through the bottom, ` +
        `against FIELD_BOTTOM (${FIELD_BOTTOM}) — which is also where the ` +
        `bottom HUD strip starts, at stage ${STAGE} (specs/swarm.md, ` +
        `specs/field.md)`,
    );
  }
});
