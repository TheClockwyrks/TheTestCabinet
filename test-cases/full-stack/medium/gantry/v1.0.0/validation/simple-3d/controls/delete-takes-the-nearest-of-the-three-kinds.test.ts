// controls/delete-takes-the-nearest-of-the-three-kinds — a delete click takes
// the nearest of the three kinds in screen distance, not the first kind that is
// in range.
//
// `specs/controls.md` § The build tools: "Delete: a click removes what it picks,
// the nearest in screen distance of a member within `MEMBER_PICK_PX`, a
// counterweight within `NODE_PICK_PX` of its node, or the ring within
// `NODE_PICK_PX` of any of its eight flange nodes. A tie goes to the member, then
// the counterweight, then the ring." The tie order is only reached where two
// kinds stand at the SAME distance; where one is nearer, distance decides. So a
// counterweight nearer the click than a member that is also in range must be the
// one that goes, and a build that ran the tie order first — member, then
// counterweight, then ring — would take the member instead.
//
// THE SCENARIO PUTS THE COUNTERWEIGHT ON A FLANGE NODE, which is the only way to
// hang one where no member ends: `specs/structure.md` places a counterweight "on
// any node the structure uses, a node a member ends at or a flange node of the
// ring". A counterweight on a member's own end node could never be nearer to a
// click than that member, because the member's segment reaches the same node.
//
// AND THE MEMBER IS A LONG CABLE WHOSE DRAWN LINE PASSES CLOSE TO THAT NODE.
// `MEMBER_PICK_PX` (`12`) is narrower than the stage distance between two lattice
// nodes at any camera distance the game allows, so the only way to put a member
// in range of a click that is nearer the counterweight is a member drawn ACROSS
// the flange node's neighbourhood from another depth. How near it passes depends
// on the lens the build draws through, which `specs/controls.md` leaves to the
// build, so a camera distance that puts the cable's drawn line a workable
// `GAP_WANTED` pixels from the flange node is searched for and used. The click
// then sits three tenths of the way from the counterweight toward the cable: the
// counterweight is `0.3` of that gap away and the cable at least `0.7` of it, so
// the counterweight is strictly the nearer and the cable is comfortably inside
// `MEMBER_PICK_PX`.
//
// THE SEARCH IS A LADDER AND A BISECTION, not a scan of every distance. A gap in
// stage pixels shrinks as the camera pulls back, so a handful of distances spread
// across the range the game allows brackets the gap this check wants, and halving
// that bracket closes on it. Each reading of a distance is four crossings into
// the page, and the distance that is finally used is held to the same assertions
// whichever way it was found — the search only has to FIND a workable camera, and
// the readings below are what decide that it is one.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertLessThan,
  assertNotNull,
  fail,
} from "../assert";
import {
  CAMERA_DIST_MAX,
  CAMERA_DIST_MIN,
  MEMBER_PICK_PX,
  NODE_PICK_PX,
} from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The ring's base corner, and the flange node the counterweight hangs on. */
const RING = { x: 4, y: 4, z: 4 } as const;
const FLANGE = { x: 4, y: 6, z: 4 } as const;

/** The one member: a cable drawn across the flange node from another depth. */
const CABLE = {
  a: { x: -4, y: 12, z: 12 },
  b: { x: 10, y: 4, z: 0 },
} as const;

/** Where the click sits between the counterweight and the cable. */
const TOWARD_CABLE = 0.3;

/** The stage gap between the flange node and the cable this check aims for. */
const GAP_WANTED = 12;

/** The gaps it can work with: wide enough to read, narrow enough to reach. */
const GAP_MIN = 6;
const GAP_MAX = 17;

/** Distances the ladder tries, spread across the range the game allows. */
const LADDER_STEPS = 6;

/** Halvings of the bracket the ladder leaves, when no rung is workable. */
const BISECTIONS = 6;

/** A point on the stage. */
interface Stage {
  x: number;
  y: number;
}

/** The nearest point of the segment `a`-`b` to `p`, and how far off it is. */
function toSegment(p: Stage, a: Stage, b: Stage): { near: Stage; gap: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const raw = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const s = Math.min(1, Math.max(0, raw));
  const near = { x: a.x + s * dx, y: a.y + s * dy };
  return { near, gap: Math.hypot(near.x - p.x, near.y - p.y) };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the nearer counterweight rather than the member in range", async () => {
  await openSite(h, 0);
  await clearAll(h);

  // The camera distance that draws the cable a workable gap from the flange
  // node, read off the build's own projection at the distances it is asked about.
  const readings: { dist: number; gap: number }[] = [];

  /** Where the cable's drawn line passes the flange node at `dist`. */
  const gapAt = async (dist: number): Promise<number | null> => {
    await h.debug.setCamera(45, 30, dist);
    const flange = await h.project(FLANGE.x, FLANGE.y, FLANGE.z);
    const a = await h.project(CABLE.a.x, CABLE.a.y, CABLE.a.z);
    const b = await h.project(CABLE.b.x, CABLE.b.y, CABLE.b.z);
    if (!flange.visible) return null;
    const { gap } = toSegment(flange, a, b);
    readings.push({ dist, gap });
    return gap;
  };

  /** The workable distance read so far whose gap is nearest the one wanted. */
  const best = (): { dist: number; gap: number } | null =>
    readings
      .filter((one) => one.gap >= GAP_MIN && one.gap <= GAP_MAX)
      .reduce<{
        dist: number;
        gap: number;
      } | null>(
        (kept, one) =>
          kept === null ||
          Math.abs(one.gap - GAP_WANTED) < Math.abs(kept.gap - GAP_WANTED)
            ? one
            : kept,
        null,
      );

  // The ladder: distances spread geometrically across the range the camera
  // allows, because a gap in pixels falls with the distance rather than with the
  // difference between two distances.
  const ratio = (CAMERA_DIST_MAX / CAMERA_DIST_MIN) ** (1 / (LADDER_STEPS - 1));
  for (let step = 0; step < LADDER_STEPS; step += 1) {
    await gapAt(CAMERA_DIST_MIN * ratio ** step);
  }

  // And the bisection: where no rung was workable, the gap wanted lies between
  // the nearest rung too wide and the nearest too narrow, so that bracket is
  // halved until it lands inside.
  let wide = [...readings].reverse().find((one) => one.gap > GAP_MAX) ?? null;
  let narrow = readings.find((one) => one.gap < GAP_MIN) ?? null;
  for (let step = 0; step < BISECTIONS; step += 1) {
    if (best() !== null || wide === null || narrow === null) break;
    const dist = (wide.dist + narrow.dist) / 2;
    const gap = await gapAt(dist);
    if (gap === null) break;
    if (gap > GAP_MAX) wide = { dist, gap };
    else narrow = { dist, gap };
  }

  const chosen = best();
  if (chosen === null) {
    fail(
      `the cable drawn between ${GAP_MIN} and ${GAP_MAX} stage pixels from ` +
        "the flange node at some camera distance the game allows, so a click " +
        "can stand nearer the counterweight than the member while both are in " +
        "range (specs/controls.md)",
      "no camera distance draws it there",
    );
  }
  await h.debug.setCamera(45, 30, chosen.dist);

  await h.debug.setRing(RING.x, RING.y, RING.z);
  await h.debug.addCounterweight(FLANGE.x, FLANGE.y, FLANGE.z);
  await h.debug.addMember(
    CABLE.a.x,
    CABLE.a.y,
    CABLE.a.z,
    CABLE.b.x,
    CABLE.b.y,
    CABLE.b.z,
    "cable",
  );
  await h.debug.setTool("delete");

  const posed = await h.snapshot();
  assertNotNull(posed.structure.ring, "the ring the scenario places");
  assertLength(
    posed.structure.counterweights,
    1,
    "the counterweight the scenario hangs on a flange node",
  );
  assertLength(
    posed.structure.members,
    1,
    "the one member the scenario places",
  );
  assertEqual(posed.tool, "delete", "the tool the click is made under");

  // The click: three tenths of the way from the counterweight to the cable.
  const flange = await h.project(FLANGE.x, FLANGE.y, FLANGE.z);
  const a = await h.project(CABLE.a.x, CABLE.a.y, CABLE.a.z);
  const b = await h.project(CABLE.b.x, CABLE.b.y, CABLE.b.z);
  const { near } = toSegment(flange, a, b);
  const click = {
    x: flange.x + TOWARD_CABLE * (near.x - flange.x),
    y: flange.y + TOWARD_CABLE * (near.y - flange.y),
  };
  const toCounterweight = Math.hypot(click.x - flange.x, click.y - flange.y);
  const toCable = toSegment(click, a, b).gap;

  // Both kinds are in range, and the counterweight is the nearer of the two.
  assertLessThan(
    toCounterweight,
    NODE_PICK_PX,
    "the stage distance from the click to the counterweight's node, against " +
      "NODE_PICK_PX (specs/controls.md)",
  );
  assertLessThan(
    toCable,
    MEMBER_PICK_PX,
    "the stage distance from the click to the cable, against MEMBER_PICK_PX " +
      "(specs/controls.md)",
  );
  assertLessThan(
    toCounterweight,
    toCable,
    "the counterweight's stage distance from the click, against the member's",
  );
  // And no other flange node is nearer than the counterweight, so the ring
  // cannot be what the click is nearest to.
  for (const dx of [0, 2]) {
    for (const dy of [0, 2]) {
      for (const dz of [0, 2]) {
        const node = {
          x: RING.x + dx,
          y: RING.y + dy,
          z: RING.z + dz,
        };
        if (node.x === FLANGE.x && node.y === FLANGE.y && node.z === FLANGE.z) {
          continue;
        }
        const at = await h.project(node.x, node.y, node.z);
        assertLessThan(
          toCounterweight,
          Math.hypot(at.x - click.x, at.y - click.y),
          `the counterweight's distance from the click, against the ring's ` +
            `flange node (${node.x}, ${node.y}, ${node.z})`,
        );
      }
    }
  }

  await h.click(click.x, click.y);
  await h.capture(
    "state",
    "the yard after the delete click near the counterweight",
  );

  const s = await h.snapshot();
  assertLength(
    s.structure.counterweights,
    0,
    "the counterweights after a delete click that stands nearer the " +
      `counterweight (${toCounterweight.toFixed(1)} px) than the member in ` +
      `range (${toCable.toFixed(1)} px), which distance decides in favour of ` +
      "the counterweight (specs/controls.md)",
  );
  assertLength(
    s.structure.members,
    1,
    "the members after that click: the farther member stands, because a " +
      "delete removes the nearest of the three kinds and only one of them " +
      "(specs/controls.md)",
  );
});
