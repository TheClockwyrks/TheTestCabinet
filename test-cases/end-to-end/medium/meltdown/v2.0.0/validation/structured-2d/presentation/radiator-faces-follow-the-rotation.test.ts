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
// WHAT IT DOES NOT DECIDE. That the rotation is fixed at placement, and reported
// in world orientation, are `towers` and `building` items; nothing here reads a
// snapshot field. A build that draws no radiator marking anywhere fails here,
// because a face that carries nothing cannot change.

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
import { NOISE_MARGIN, faceBand, largestShift, readRegion } from "./read";

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

/** One rotation's face bands, read twice so the frame's own movement shows. */
interface Reading {
  first: Record<Face, Rgb[]>;
  second: Record<Face, Rgb[]>;
}

/** Every face band read on one frame of the tower as it now stands. */
function readFaces(h: Harness): Record<Face, Rgb[]> {
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

/** The tower posed at `rotation`, and its face bands read on two frames. */
async function bandsAt(
  h: Harness,
  rotation: number,
  outputId: string,
): Promise<Reading> {
  startRun(h);
  poseStillTower(h, TYPE, COL, ROW, rotation);
  await h.advance(1);
  const first = readFaces(h);
  await h.advance(1);
  captureStill(h, outputId);
  return { first, second: readFaces(h) };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("marks the faces rotation 1 gives, and no longer rotation 0's", async () => {
  const unturned = await bandsAt(h, 0, "unturned");
  const turned = await bandsAt(h, 1, "turned");

  /** How far the band on `face` moves between two frames at one rotation. */
  const noiseOn = (face: Face): number =>
    Math.max(
      largestShift(unturned.first[face], unturned.second[face]),
      largestShift(turned.first[face], turned.second[face]),
    );

  const rule =
    `a ${TYPE}, whose world radiator faces are ` +
    `${worldRadiators(TYPE, 0).join(", ")} at rotation 0 and ` +
    `${worldRadiators(TYPE, 1).join(", ")} at rotation 1 (specs/towers.md: ` +
    `the rotation turns the local faces N -> E -> S -> W)`;

  for (const face of CHANGES) {
    const noise = noiseOn(face);
    assertGreaterThanOrEqual(
      largestShift(unturned.second[face], turned.second[face]),
      noise + NOISE_MARGIN,
      `${rule}: its ${face} face, which exactly one of the two rotations ` +
        `marks, is drawn differently at rotation 1 than at rotation 0 — past ` +
        `the ${noise} that band moves between two frames at one rotation`,
    );
  }

  for (const face of KEEPS) {
    const noise = noiseOn(face);
    assertLessThanOrEqual(
      largestShift(unturned.second[face], turned.second[face]),
      noise + NOISE_MARGIN,
      `${rule}: its ${face} face, which is a radiator face at BOTH ` +
        `rotations, is drawn the same way at rotation 1 as at rotation 0 — ` +
        `within the ${noise} that band moves between two frames at one ` +
        `rotation`,
    );
  }
});
