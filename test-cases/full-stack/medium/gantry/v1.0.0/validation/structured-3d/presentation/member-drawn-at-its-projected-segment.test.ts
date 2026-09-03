// presentation/member-drawn-at-its-projected-segment — a placed member is drawn
// along the segment joining its two nodes.
//
// specs/ui.md § Build: `build` "shows the yard through the camera: the ground,
// the site's anchors and obstacles, the buildable lattice and envelope aids, the
// structure as built, and each load at its starting pose with its pad".
// specs/overview.md § Hard requirements: "Render a real 3D scene on the canvas:
// the yard, the lattice aids, the crane's members and parts, the loads, and the
// readouts". specs/assets.md § What is drawn in code: the members are "each as
// real drawn geometry".
//
// SO THE PICTURE IS THE STRUCTURE IN THE WORLD. A member runs between two lattice
// nodes (specs/structure.md), so drawing it is drawing something along the line
// joining them — the whole of that line, and nothing far off it.
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
// THE READING IS A BEFORE AND AFTER, so what is found is the member's own drawing
// rather than an aid the yard already carried: the yard is emptied, the objects
// are read, one member is placed, and the objects are read again. What arrived
// has to be drawn along the segment.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  drawnObjects,
  openSite,
  type DrawnObject,
  type Harness,
  type Vec3,
} from "../harness";

const SITE = 0;

/** The one member: a strut standing clear of everything else in the yard. */
const FROM: Vec3 = { x: 8, y: 4, z: 0 };
const TO: Vec3 = { x: 8, y: 10, z: 0 };

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

it("draws a placed member along the segment between its two nodes", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);

  const before = new Set(
    drawnObjects(h).map((object) => JSON.stringify(object.box)),
  );

  await h.debug.addMember(FROM.x, FROM.y, FROM.z, TO.x, TO.y, TO.z, "strut");
  await h.advance(1);
  await h.capture("member", "One member standing between its two nodes");

  assertEqual(
    (await h.snapshot()).structure.members.length,
    1,
    "the member the placement stood in the yard (specs/structure.md)",
  );

  const arrived = drawnObjects(h).filter(
    (object) => !before.has(JSON.stringify(object.box)),
  );
  assertTrue(
    arrived.length > 0,
    "something drawn once a member is placed, since the build screen shows " +
      '"the structure as built" (specs/ui.md § Build)',
  );
  assertTrue(
    arrived.some((object) => drawnAlong(object, FROM, TO)),
    `something drawn along the segment (${FROM.x}, ${FROM.y}, ${FROM.z}) to ` +
      `(${TO.x}, ${TO.y}, ${TO.z}), which is where the placed member runs ` +
      "(specs/structure.md, specs/ui.md § Build). What arrived spans " +
      JSON.stringify(
        arrived.map((object) => [object.box?.min, object.box?.max]),
      ),
  );
});
