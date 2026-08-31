// presentation/radiator-faces-follow-the-rotation — the faces drawn distinctly on
// a tower placed at rotation 1 are the ones its rotation gives it.
//
// THE RULE. `specs/towers.md`: "The rotation turns the local faces into world
// faces in the order `N -> E -> S -> W`, so rotation `1` turns a local `N` into a
// world `E` ... A tower's radiator faces are reported and drawn in world
// orientation." So at rotation `1` a Stutter, whose local radiators are N and E,
// sheds well on its world E and S faces, and the marking `specs/overview.md`
// requires has to be on those two.
//
// WHY A STUTTER AND WHY ROTATION 1. The set has to be one that every wrong model
// gets wrong differently, and `specs/towers.md` supplies exactly one asymmetric
// pair: the Stutter's local N and E. Turned one step it becomes `{E, S}`. A build
// that never turns its faces leaves them at `{N, E}`; one that turns them the
// wrong way round reaches `{W, N}`; one that turns them two steps reaches
// `{S, W}`. All four sets are different, which is what lets the two readings below
// name which of them the build implemented. A symmetric pair — the Arc's `{N, S}`,
// which turns into `{E, W}` — could not tell a build that turned the right way
// from one that turned the wrong way at all.
//
// THE TWO READINGS, AND WHY BOTH ARE NEEDED.
//
//   1. AT ROTATION 1, EACH FACE THE ROTATION MAKES A RADIATOR READS APART FROM
//      EACH ONE IT LEAVES PLAIN. That refuses a build that never turned the faces
//      (its world E and N are both radiators, so the pair reads alike) and one that
//      turned them two steps (its E and N are both plain).
//   2. THE FACE THAT CHANGES ACROSS THE TURN HAS CHANGED. World N is a radiator at
//      rotation `0` and is not one at rotation `1`, so the same band on the same
//      tile must read differently in the two frames. This is the reading that
//      refuses a build that turns its faces the WRONG WAY: `{W, N}` keeps N a
//      radiator, and every pair in reading 1 is radiator-against-plain there, so
//      reading 1 alone would pass it.
//
// WHY THE SECOND READING IS FAIR. The two frames differ in ONE thing. The tower is
// the same type on the same tile at the same heat with the same faculties, so the
// footprint is the same rectangle (`specs/towers.md`: "A footprint's size and shape
// are the same at every rotation"), the body is the same colour, and anything
// `specs/hud.md` lets a build draw on the footprint is drawn the same way. The only
// thing the check changed is which faces are radiators, so a band that moved is a
// band whose face treatment moved.
//
// WHY THE SECOND TOWER IS A SECOND TOWER. `specs/building.md`: "A tower's
// orientation is fixed at the moment it is placed: a placed tower's rotation and
// its world radiator faces never change again." So the rotation-1 reading is taken
// on a tower posed at rotation 1, not on the first one turned.
//
// WHAT IT DOES NOT DECIDE. That a radiator face is drawn distinctly AT ALL is
// `presentation/radiator-faces-read`, and what the snapshot REPORTS for
// `radiatorFaces` is `towers/`'s item. This is pixels, and it is about which faces.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { SIDES, worldRadiators } from "../constants";
import type { Side } from "../constants";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  requireTower,
  startRun,
  type Harness,
  type Rgb,
} from "../harness";
import { faceBands, showRgb, widestGap } from "./read";

/**
 * How far two face bands must sit apart to count as drawn differently, out of the
 * 441 the RGB cube spans.
 *
 * This group's figure for "plainly apart" (`specs/overview.md`), the same one
 * `presentation/radiator-faces-read` holds a radiator face against a plain one to
 * — deliberately the same, because both readings below are asking exactly that
 * question, once within a frame and once across two.
 */
const APART_MIN = 60;

/** The type read, and where it stands: clear of the casing and both corridors. */
const TYPE = "stutter";
const AT = { col: 12, row: 8 } as const;

/** The two rotations, and the radiator sets `specs/towers.md` gives each. */
const AT_ZERO: readonly Side[] = worldRadiators(TYPE, 0);
const AT_ONE: readonly Side[] = worldRadiators(TYPE, 1);
const PLAIN_AT_ONE: readonly Side[] = SIDES.filter(
  (side) => !AT_ONE.includes(side),
);
/** The faces the turn takes the marking OFF: a radiator at 0 and not at 1. */
const RELEASED: readonly Side[] = AT_ZERO.filter(
  (side) => !AT_ONE.includes(side),
);

/** Pose the type at `rotation`, render a frame, and read its four face bands. */
async function bandsAt(
  h: Harness,
  rotation: 0 | 1,
): Promise<Record<Side, Rgb[]>> {
  await h.debug.clearTowers();
  const id = await posePinnedTower(h, TYPE, AT.col, AT.row, 0, rotation);
  await h.advance(1);
  await captureStill(h, rotation === 0 ? "unturned" : "turned");
  const tower = requireTower(await h.snapshot(), id, `rotation ${rotation}`);
  return faceBands(h, tower);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("marks the faces rotation 1 gives it, and not the ones it leaves plain", async () => {
  await startRun(h);
  const turned = await bandsAt(h, 1);

  for (const radiator of AT_ONE) {
    for (const plain of PLAIN_AT_ONE) {
      const gap = widestGap(turned[radiator], turned[plain]);
      assertGreaterThanOrEqual(
        gap.distance,
        APART_MIN,
        `a ${TYPE} at rotation 1: its world ${radiator} face, which its ` +
          `rotation makes a radiator (${showRgb(gap.left)}), against its ` +
          `world ${plain} face, which it leaves plain (${showRgb(gap.right)}) ` +
          `(specs/towers.md turns local ${AT_ZERO.join(" and ")} into world ` +
          `${AT_ONE.join(" and ")} at rotation 1)`,
      );
    }
  }
});

it("takes the marking off the face the turn releases", async () => {
  await startRun(h);
  const unturned = await bandsAt(h, 0);
  const turned = await bandsAt(h, 1);

  for (const side of RELEASED) {
    const gap = widestGap(unturned[side], turned[side]);
    assertGreaterThanOrEqual(
      gap.distance,
      APART_MIN,
      `a ${TYPE}'s world ${side} face, a radiator at rotation 0 ` +
        `(${showRgb(gap.left)}) and not one at rotation 1 ` +
        `(${showRgb(gap.right)}): the same band on the same tile is drawn ` +
        `differently at the two rotations (specs/towers.md: radiator faces ` +
        `are drawn in world orientation, so turning the tower moves them)`,
    );
  }
});
