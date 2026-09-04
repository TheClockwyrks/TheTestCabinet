// Wireworm — instrumentation/worm-body-gate: `setWormBody(id, false)` holds the
// trailing segments while the head goes on stepping.
//
// specs/instrumentation.md: "Gates the body's follow alone. Off, the head steps
// as usual and every trailing segment holds its tile." specs/worm.md is what the
// gate suspends: every step, once the head has moved, each remaining segment
// moves into the tile the segment ahead of it occupied before that step.
//
// WHY THE SUITE RESTS ON IT. It is what lets a check about WHERE THE HEAD GOES
// move exactly one tile and read exactly one tile: with the body following, a
// four-segment worm changes four tiles a step and a reading about the head has to
// pick it out of them. Half the `worm` group is posed this way, so the gate is
// proved here before anything leans on it.
//
// THE TWO HALVES ARE SAMPLED EVERY FRAME, not read once at the end. A build whose
// body follows on the first step and then stops would pass an end-of-sweep
// reading of the head; what is asserted instead is that the trailing segments
// stood on their posed tiles at EVERY frame of the sweep, and that the head
// changed tile exactly once per step interval, moving one tile each time.
//
// WHICH tile the head moves to is `worm.winds-horizontal`'s point. This one counts
// changes and measures each as a one-tile move, so a build with a working gate
// and a crooked wind fails that point and not this one. The worm winds along an
// empty row, so nothing but the gate can decide what moves.

import { afterEach, beforeEach, it } from "vitest";
import { wormStepInterval } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  headOf,
  poseWorm,
  sameTile,
  startPlaying,
  ticksFor,
  tileKey,
  wormOf,
  type Harness,
  type TileSnapshot,
} from "../harness";

/** The worm posed: four segments on a clear row, well inside both side edges. */
const WORM_C = 10;
const WORM_R = 5;
const WORM_LENGTH = 4;

/** How many steps the sweep covers. */
const STEPS = 3;

/**
 * Frames covering three and a half of level 1's `0.14` s step intervals
 * (specs/worm.md), so the sweep lands past the third step and half an interval
 * short of the fourth.
 */
const SWEEP_TICKS = ticksFor(wormStepInterval(1) * (STEPS + 0.5));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("advances the head one tile per step while every trailing segment holds", async () => {
  startPlaying(h);

  const id = poseWorm(h, WORM_C, WORM_R, WORM_LENGTH);
  h.debug.setWormBody(id, false);

  const posed = wormOf(h.snapshot(), id).segments;
  const trail = posed.slice(1).map(tileKey);

  let headAt: TileSnapshot = headOf(wormOf(h.snapshot(), id));
  let steps = 0;

  for (let frame = 0; frame < SWEEP_TICKS; frame += 1) {
    await h.advance(1);
    const worm = wormOf(h.snapshot(), id);

    // Every frame of the sweep, not merely the last: the trailing segments are
    // on the tiles they were posed on, in the order they were posed in.
    assertDeepEqual(
      worm.segments.slice(1).map(tileKey),
      trail,
      `every trailing segment holds its tile with the body gated off ` +
        `(frame ${String(frame + 1)})`,
    );

    const head = headOf(worm);
    if (!sameTile(head, headAt)) {
      const moved = Math.abs(head.c - headAt.c) + Math.abs(head.r - headAt.r);
      assertEqual(
        moved,
        1,
        `step ${String(steps + 1)} advances the head one tile ` +
          "(specs/worm.md)",
      );
      steps += 1;
      headAt = head;
    }
  }

  // The head advanced ahead of its held body.
  captureStill(h, "gated");

  assertEqual(
    steps,
    STEPS,
    `the head steps once per wormStepInterval while the body is gated off, ` +
      `which is ${String(STEPS)} steps over this span (specs/worm.md)`,
  );
  assertEqual(
    wormOf(h.snapshot(), id).segments.length,
    WORM_LENGTH,
    "the worm keeps every segment it was posed with",
  );
});
