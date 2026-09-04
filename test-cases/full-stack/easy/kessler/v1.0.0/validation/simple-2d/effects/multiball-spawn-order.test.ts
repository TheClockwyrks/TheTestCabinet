// effects/multiball-spawn-order — the +theta ball launches first.
//
// specs/pods.md, of a multiball catch: "the `+theta` ball launches first."
// specs/instrumentation.md fixes how that is read: `balls` lists every live ball
// "in spawn order", oldest first. So the pair's first entry is the one that
// launched first, and its heading must be the +theta one.
//
// THIS IS THE ORDER ALONE. That each of the two headings exists at all is
// `multiball-plus-theta` and `multiball-minus-theta`, so a build that launches
// the right pair in the wrong order loses this point and keeps those.
//
// THE WORLD IS ONE POD AND THE DEFLECTOR, so `balls` is the launched pair and
// nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLength } from "../assert";
import {
  close,
  dropPod,
  MULTI_OFFSET,
  open,
  record,
  START_ANGLE,
  velocityAt,
  world,
  type Harness,
} from "./pose";

/** How far a heading may sit from the stated 20 degrees. */
const TOL_DEG = 3;

let h: Harness;

beforeEach(async () => {
  h = await open();
});

afterEach(async () => {
  await close(h);
});

it("puts the +theta ball first in spawn order", async () => {
  await world(h);

  const after = await record(h, "order", () => dropPod(h, "multiball"));

  assertLength(after.balls, 2, "the launched pair");
  assertCloseTo(
    velocityAt(after.balls[0], START_ANGLE).offDeg,
    MULTI_OFFSET,
    TOL_DEG,
    "the first ball in spawn order heads to the +theta side",
  );
});
