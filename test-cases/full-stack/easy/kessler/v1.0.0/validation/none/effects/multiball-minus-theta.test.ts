// effects/multiball-minus-theta — the other of the launched pair heads 20
// degrees to the -theta side of the outward radial.
//
// specs/pods.md, of a multiball catch: "One heads `20` degrees to the `+theta`
// side of the outward radial and the other `20` degrees to the `-theta` side."
// This point is the -theta heading; `multiball-plus-theta` is the other, and
// `multiball-spawn-order` is which of them launched first — three requirements a
// build can miss separately.
//
// THE HEADING IS MEASURED AGAINST THE OUTWARD RADIAL AT THE DEFLECTOR'S CENTER
// ANGLE, where the launch minted the velocity and nothing in the emptied world
// has changed it since, so the reading is the stated 20 to float precision.
//
// THE WORLD IS ONE POD AND THE DEFLECTOR, so the pair the catch launched is the
// whole of `balls`. Which entry carries the -theta heading is not assumed: the
// pair is searched, so a build whose spawn order is wrong fails the order point
// alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertTrue } from "../assert";
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

it("launches a ball 20 degrees to the -theta side of the radial", async () => {
  await world(h);

  const after = await record(h, "minus-theta", () => dropPod(h, "multiball"));

  assertLength(after.balls, 2, "the launched pair");
  const offsets = after.balls.map(
    (ball) => velocityAt(ball, START_ANGLE).offDeg,
  );
  assertTrue(
    offsets.some((off) => Math.abs(off + MULTI_OFFSET) <= TOL_DEG),
    `one of the pair heading ${MULTI_OFFSET} degrees to -theta ` +
      `(read ${offsets.map((o) => o.toFixed(2)).join(", ")})`,
  );
});
