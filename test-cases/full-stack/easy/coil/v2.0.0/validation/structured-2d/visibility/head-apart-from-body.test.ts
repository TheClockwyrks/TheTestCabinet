// visibility/head-apart-from-body — the head cell is not the colour of the body
// behind it.
//
// WHAT THE SPECIFICATION FIXES. `specs/overview.md` requires the head cell drawn
// distinctly from every body cell, "so the leading cell is unmistakable at any
// length", and `specs/assets.md` states the same requirement of the produced art:
// "the head is clearly brighter or otherwise stronger than the body, so the
// leading cell separates from the trail at any length". Neither fixes a palette,
// so what is read is separation alone, against the review item's figure for
// clearly apart: more than 50 of the 441 the RGB cube spans.
//
// THE WORLD THIS POSES. A chain long enough to hold a MIDDLE body cell — one
// that is neither the head nor the last cell, since `specs/assets.md` draws the
// last cell with the tail sprite and this point is about the body. The pellet is
// off the board and the obstacle course is cleared, so nothing else is painted
// near either sample, and travel is switched off because a colour exercises no
// faculty of the snake's.
//
// The chain runs straight, so the body cell sampled is a straight run rather
// than a bend: both are body, and a straight run is the cell a player sees most
// of.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  chainFrom,
  colorDistance,
  createHarness,
  HOME_HEAD,
  poseScene,
  sampleCells,
  type Harness,
} from "../harness";

/** The review item's distance: clearly apart on the 0–441 RGB scale. */
const DISTINCT_MIN = 50;

/** Head, one straight body cell, a second, and the tail. */
const LENGTH = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the head apart from a body cell", async () => {
  const chain = chainFrom(HOME_HEAD, "right", LENGTH);
  poseScene(h, {
    snake: chain,
    dir: "right",
    pellet: null,
    travel: false,
  });
  await h.advance(1);
  captureStill(h, "scene");

  // Index 1: the cell directly behind the head, a straight run between two
  // neighbours and not the last cell of the chain.
  const [head, body] = sampleCells(h, [chain[0], chain[1]]);

  assertGreaterThan(
    colorDistance(head, body),
    DISTINCT_MIN,
    "the RGB distance between the head cell's centre and a body cell's",
  );
});
