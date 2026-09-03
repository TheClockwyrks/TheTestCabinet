// presentation/hoist-cable-drawn-pivot-to-bob — the hoist cable is drawn from the
// pivot to the bob.
//
// specs/rigging.md § The pivot and the bob: "The hoist cable hangs from the
// pivot: the trolley point, on the rail track at the trolley's position, rotated
// with the arm. Its length is the hoist axis's value `L`... The cable is
// inextensible: the bob stays at distance `L` from the pivot. IT IS DRAWN FROM
// PIVOT TO BOB and is otherwise massless." So the drawn cable is the hoist axis
// made visible: lengthen the axis and the drawn line reaches further down, and it
// stops where the bob is.
//
// THE READING, UNDER AN ENGINE. There is no rasterizer in this project —
// `validation/host.ts` gives three a WebGL2 context that answers every call and
// draws nothing — so a claim about the yard is made against what the engine WOULD
// draw: `drawnObjects` answers every object the world pass will draw this frame,
// with the box its geometry fills and every one of its vertices, in world units.
// `engine/rendering.md` fixes that the pipeline collects every enabled, visible
// render component on every live actor and draws it, so any build of this case
// that puts something on screen puts it there.
//
// NOTHING IS FOUND BY NAME. What a build calls an object, which component it
// reaches for and what it paints with are the build's; what a check finds an
// object by is WHERE IT IS and WHAT SHAPE IT HAS.
//
// TWO CABLE LENGTHS, because one cannot tell a line drawn from pivot to bob from
// a line of some fixed length hung under the carriage. Both ends are read against
// the run's OWN pivot and bob rather than against figures this file worked out,
// so what the drawing is held to is the build's own answer for where the cable
// runs.
//
// NO LOAD IS ATTACHED — the sentence holds whether or not one is, and the bare
// hook is the simpler world — and the tape is a single grip move, the only axis
// whose motion "applies no force to anything" (specs/rigging.md), so the run
// keeps running while the two readings are taken and nothing else moves.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  drawnObjects,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type DrawnObject,
  type Harness,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

const SITE = 0;

/** A move that keeps the run running and moves nothing (specs/rigging.md). */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/** Where the carriage stands, and the two cable lengths read. */
const TROLLEY = 4;
const LENGTHS = [1.5, 3.5] as const;

/** How far a drawing may lie off the segment it is drawn along. */
const OFF_LINE = 0.25;

/** How near a drawing's ends must come to the segment's own. */
const SHORT = 0.25;

/**
 * Whether `object` is drawn ALONG the segment `from`-`to`.
 *
 * Three things at once, and each of them is part of "drawn along it": every
 * vertex stands within `OFF_LINE` of the line, so it is not a shape that merely
 * crosses it; the drawing reaches within `SHORT` of each end, so it is not a stub
 * on part of it; and it does not run past either end by more than `SHORT`, so it
 * is not a line through the whole yard that happens to contain the segment.
 *
 * The tolerance is a quarter of a unit, which is an eighth of `LATTICE_PITCH`
 * (`2`): room for a member drawn with real thickness — specs/assets.md has them
 * "each as real drawn geometry" — and far short of the next node along.
 */
function drawnAlong(object: DrawnObject, from: Vec3, to: Vec3): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const span = Math.hypot(dx, dy, dz);
  if (span === 0) return false;
  let least = Infinity;
  let most = -Infinity;
  for (const point of object.points()) {
    const t =
      ((point.x - from.x) * dx +
        (point.y - from.y) * dy +
        (point.z - from.z) * dz) /
      (span * span);
    const on = {
      x: from.x + dx * t,
      y: from.y + dy * t,
      z: from.z + dz * t,
    };
    if (Math.hypot(point.x - on.x, point.y - on.y, point.z - on.z) > OFF_LINE) {
      return false;
    }
    least = Math.min(least, t);
    most = Math.max(most, t);
  }
  if (least === Infinity) return false;
  const slack = SHORT / span;
  return (
    least <= slack && least >= -slack && most >= 1 - slack && most <= 1 + slack
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the cable down to the bob the hoist length puts there", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);
  await h.debug.setAxis("trolley", TROLLEY);

  for (const length of LENGTHS) {
    // The bob hung straight under the carriage on a cable of exactly that
    // length, so the constraint is already satisfied and the frame moves
    // nothing.
    const pivot = (await h.snapshot()).run.pivot;
    await h.debug.setBob(pivot.x, pivot.y - length, pivot.z);
    await h.debug.setBobVelocity(0, 0, 0);
    await h.debug.setAxis("hoist", length);
    await h.advance(1);

    const run = (await h.snapshot()).run;
    const drawn: DrawnObject[] = drawnObjects(h);
    assertTrue(
      drawn.some((object) => drawnAlong(object, run.pivot, run.bob.pos)),
      "something drawn along the segment from the pivot, " +
        `(${run.pivot.x.toFixed(2)}, ${run.pivot.y.toFixed(2)}, ` +
        `${run.pivot.z.toFixed(2)}), to the bob, ` +
        `(${run.bob.pos.x.toFixed(2)}, ${run.bob.pos.y.toFixed(2)}, ` +
        `${run.bob.pos.z.toFixed(2)}), at hoist ${length}: the cable "is ` +
        'drawn from pivot to bob" (specs/rigging.md)',
    );
  }

  await h.capture("cable", "The cable from the pivot to the bob");
});
