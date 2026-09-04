// presentation/radiator-faces-follow-the-rotation — the marking turns with the
// tower.
//
// THE RULE. specs/towers.md: "The rotation turns the local faces into world faces
// in the order `N -> E -> S -> W` ... A tower's radiator faces are reported and
// drawn in world orientation." So a tower placed at rotation `1` is drawing its
// radiators on the faces one step round from its local ones, and on its local
// ones no longer. specs/overview.md's legibility table is what makes that worth
// drawing at all: the player is meant to see which sides shed heat, and after a
// turn those are different sides.
//
// THE TOWER, AND WHY THE ANSWER IS UNAMBIGUOUS. The Rime, whose local radiators
// are N, S and E, so exactly one of its four faces is plain (specs/towers.md).
// One step turns that set into E, S and W. Each of the four faces therefore
// answers a different way, and between them they say the whole rule:
//
//   N   marked at rotation 0 and not at rotation 1  -> it must CHANGE
//   W   marked at rotation 1 and not at rotation 0  -> it must CHANGE
//   E   marked at both                              -> it must NOT change
//   S   marked at both                              -> it must NOT change
//
// and every wrong model of the rotation reads as a different number. A build that
// ignores the rotation, one that turns two steps, and one that turns the wrong
// way all leave N marked, so all three fail on N and none of them can be mistaken
// for a pass. A build that simply redraws its tower differently whenever the
// rotation changes fails on E and S. Only one step, the way specs/towers.md
// states, answers all four.
//
// HOW IT IS READ, AND WHY THE READING IS A DIFFERENCE. The SAME band of the SAME
// face of the SAME tower on the SAME tile at the SAME heat, on two frames, one
// with the tower placed at rotation `0` and one at rotation `1`. Nothing about a
// build's palette is named, and no absolute colour is read at all: whatever a
// build draws on a footprint that does not depend on the rotation — a body, an
// outline, a label, the heat read specs/hud.md asks for — is identical in both
// frames and cancels out of every reading, pixel for pixel. What is left is
// exactly what the rotation moved, which is what this point is about.
//
// WHAT IT DOES NOT DECIDE. That the marking is distinct AT ALL is
// `radiator-faces-read`; a build that draws no radiator marking anywhere fails
// there, and fails here too, because a face that carries nothing cannot change.
// That the rotation is fixed at placement, and reported in world orientation, are
// `towers` and `building` items; nothing here reads a snapshot field.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  sizeOf,
  startRun,
  type Face,
  type Harness,
  type Rgb,
  type TowerType,
} from "../harness";
import { poseStillTower } from "./pose";
import { worldRadiators } from "./roster";
import { faceBand, movedFraction, readRegion } from "./read";

/**
 * How far, out of the 441 the RGB cube spans, a pixel of a face band must move
 * between the two rotations to count as having changed.
 *
 * The group's figure for two things a player tells apart at a glance, and the
 * same 50 every other point in this group draws its line at: a face that gains or
 * loses its marking has to look different, not merely differ by measurement.
 */
const APART_MIN = 50;

/**
 * How much of a face's band must change for the marking to have moved onto it or
 * off it.
 *
 * A quarter. The band is seven units deep, so this asks the marking to be a good
 * unit and a half of it — the thinnest line a player could pick out on a tower at
 * this stage size — while leaving a build free to mark a face with a fin, a bar,
 * a row of pips or a shaded edge rather than with a full-depth block.
 */
const CHANGED_MIN = 0.25;

/**
 * How much of a face's band may change while still counting as unchanged.
 *
 * The tower is posed identically in both frames and nothing in this scenario
 * moves, so a face the rotation did not touch reads zero. A twentieth is the
 * allowance for a build that plays an idle shimmer over its towers, and it is far
 * below `CHANGED_MIN`, so no reading satisfies both.
 */
const UNCHANGED_MAX = 0.05;

/**
 * The tower the rotation is read on, and where it stands.
 *
 * The Rime: specs/towers.md gives its radiators as local N, S and E, the one
 * layout in the roster whose four faces each answer the turn differently. The
 * tile is clear of the casing and of both corridors.
 */
const TYPE: TowerType = "rime";
const COL = 10;
const ROW = 10;

/** What one step of rotation does to each face of that tower. */
const CHANGES: readonly Face[] = ["N", "W"];
const KEEPS: readonly Face[] = ["E", "S"];

/**
 * How deep into the footprint each band runs, and what stretch of the face.
 *
 * From one unit in, so the footprint's own outline is outside the reading, to
 * eight, which is deeper than any marking a build would call a face; and over the
 * middle two-fifths of the face's length, so the corners it shares with its
 * neighbours are not read as if they belonged to it.
 */
const BAND_FROM = 1;
const BAND_TO = 8;
const ALONG_FROM = 0.3;
const ALONG_TO = 0.7;

/** Every face band of the tower, posed at `rotation` and drawn. */
async function readFaces(
  h: Harness,
  rotation: number,
  outputId: string,
): Promise<Record<Face, Rgb[]>> {
  startRun(h);
  poseStillTower(h, TYPE, COL, ROW, rotation);
  await h.advance(1);
  captureStill(h, outputId);

  const size = sizeOf(TYPE);
  const read = {} as Record<Face, Rgb[]>;
  for (const face of [...CHANGES, ...KEEPS]) {
    read[face] = readRegion(
      h,
      faceBand(COL, ROW, size, face, BAND_FROM, BAND_TO, ALONG_FROM, ALONG_TO),
      1,
    );
  }
  return read;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("marks the faces rotation 1 gives, and no longer rotation 0's", async () => {
  const unturned = await readFaces(h, 0, "unturned");
  const turned = await readFaces(h, 1, "turned");

  const rule =
    `a ${TYPE}, whose world radiator faces are ` +
    `${worldRadiators(TYPE, 0).join(", ")} at rotation 0 and ` +
    `${worldRadiators(TYPE, 1).join(", ")} at rotation 1 (specs/towers.md: ` +
    `the rotation turns the local faces N -> E -> S -> W)`;

  for (const face of CHANGES) {
    assertGreaterThanOrEqual(
      movedFraction(unturned[face], turned[face], APART_MIN),
      CHANGED_MIN,
      `${rule}: the proportion of its ${face} face drawn differently at ` +
        `rotation 1 than at rotation 0, which is a face exactly one of the ` +
        `two rotations marks`,
    );
  }

  for (const face of KEEPS) {
    assertLessThanOrEqual(
      movedFraction(unturned[face], turned[face], APART_MIN),
      UNCHANGED_MAX,
      `${rule}: the proportion of its ${face} face drawn differently at ` +
        `rotation 1 than at rotation 0, which must be none of it, because ` +
        `${face} is a radiator face at both rotations`,
    );
  }
});
