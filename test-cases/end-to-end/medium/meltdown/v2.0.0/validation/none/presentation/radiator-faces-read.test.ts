// presentation/radiator-faces-read — a tower's radiator faces are drawn apart
// from its plain ones.
//
// THE RULE. `specs/overview.md`'s legibility table: "Radiator faces — A tower's
// radiator faces are drawn distinctly from its plain faces, so the player can see
// which sides shed heat." It matters because of what `specs/heat.md` does with
// them: `RAD_K` (`3.6`) against `BASE_K` (`1.1`) per edge-tile, so which way a
// tower is turned is worth better than three times the air cooling on that face,
// and a player who cannot see which sides they are cannot lay out a maze.
//
// WHAT A FACE IS AND WHERE IT IS READ. `specs/heat.md` defines a face as one side
// of the footprint, "one edge-tile long per tile of the footprint's side", and
// `specs/floor.md` fixes where that footprint is. Nothing fixes how thick a face
// marking is or which side of the footprint's edge it sits on, so `read.ts` reads
// a BAND along each face — from two units outside the edge to five inside, at
// three places along the middle of the run — and the reading for a pair of faces
// is the widest gap between the two bands at the same position. The parameterisation
// is the square's own quarter-turn, so the same position on two faces names the two
// points a quarter-turn carries onto each other; `specs/towers.md` fixes that "a
// footprint's size and shape are the same at every rotation", which is what makes
// that comparison a fair one.
//
// WHY AN ARC AT ROTATION 0. `specs/towers.md` gives the Arc radiators on local N
// and S, and rotation `0` is the local orientation, so its world radiator faces
// are N and S and its plain ones are E and W. Every radiator face is asserted
// against every plain face — four pairs, each named — so a build that marks one
// of its two radiator faces and forgets the other fails on the pair it forgot.
//
// THE ONE THING THIS READING CANNOT SEPARATE, STATED HONESTLY. `specs/hud.md` puts
// a heat read "on its footprint" and leaves WHERE on the footprint to the build. A
// build that draws that read along one of its four faces makes that face differ
// from the others for a reason this item is not about, and the pairs involving it
// would pass on the heat read rather than on a radiator marking. It cannot make a
// conforming build fail — furniture only widens a gap — and it cannot let a build
// that marks nothing through either, because a heat read lies along at most one
// face and the remaining pairs are clean. The tower is posed at heat `0` so that
// what such a read shows is at its quietest.
//
// WHAT IT DOES NOT DECIDE. WHICH faces carry the marking at a rotation other than
// `0` is `presentation/radiator-faces-follow-the-rotation`'s item, and what the
// SNAPSHOT reports for `radiatorFaces` is `towers/`'s. This is pixels, at rotation
// `0`, on one tower.

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
} from "../harness";
import { faceBands, showRgb, widestGap } from "./read";

/**
 * How far a radiator face's band must sit from a plain face's, out of the 441 the
 * RGB cube spans.
 *
 * This group's figure for "plainly apart" (`specs/overview.md`), the same 50 every
 * other point in this group draws its line at, under this engine and under the
 * other two.
 */
const APART_MIN = 50;

/** The type read, and where it stands: clear of the casing and both corridors. */
const TYPE = "arc";
const AT = { col: 12, row: 8 } as const;

/** Which faces `specs/towers.md` makes radiators at rotation 0, and which not. */
const RADIATORS: readonly Side[] = worldRadiators(TYPE, 0);
const PLAIN: readonly Side[] = SIDES.filter(
  (side) => !RADIATORS.includes(side),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws each radiator face apart from each plain face", async () => {
  await startRun(h);
  const id = await posePinnedTower(h, TYPE, AT.col, AT.row, 0);
  await h.advance(1);
  await captureStill(h, "faces");

  const tower = requireTower(await h.snapshot(), id, "the faces");
  const bands = await faceBands(h, tower);

  for (const radiator of RADIATORS) {
    for (const plain of PLAIN) {
      const gap = widestGap(bands[radiator], bands[plain]);
      assertGreaterThanOrEqual(
        gap.distance,
        APART_MIN,
        `an ${TYPE}'s ${radiator} face, a radiator at rotation 0 ` +
          `(${showRgb(gap.left)}), against its ${plain} face, a plain one ` +
          `(${showRgb(gap.right)}), at the position along the two bands they ` +
          `differ most at (specs/overview.md: radiator faces are drawn ` +
          `distinctly from plain faces; specs/towers.md gives the ${TYPE} ` +
          `radiators on ${RADIATORS.join(" and ")})`,
      );
    }
  }
});
