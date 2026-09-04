// presentation/radiator-faces-read — a player can see which sides shed heat.
//
// THE RULE. specs/overview.md's legibility table: "A tower's radiator faces are
// drawn distinctly from its plain faces, so the player can see which sides shed
// heat." specs/heat.md is what makes it worth seeing — an edge-tile on a radiator
// face sheds `RAD_K` and a plain one `BASE_K`, better than three times as much —
// and specs/towers.md is what says which faces a type has: a Lance's radiators
// are local N and E, so at rotation `0` its world E face is a radiator and its
// world W face is not.
//
// THE PAIR THIS POINT READS, AND WHY IT IS E AGAINST W. The two are the SAME
// READING taken on opposite sides of one tower: the same depth into the
// footprint, the same stretch of the face, the same tower, the same heat, on the
// same frame. So anything a build draws uniformly over its towers — a body
// shade, an outline, a bevel, a radial glow — reads identically at the same depth
// on both sides and cannot decide the comparison, and the only thing that can is
// a marking the build put on one face and not the other. The N and S faces are
// deliberately not the pair: specs/hud.md asks every tower to carry a heat read
// ON its footprint, a build is free to lay that along the top or the bottom edge,
// and a reading that ran through it would be reading the heat read rather than a
// face.
//
// WHY THE READING IS TAKEN SHELL BY SHELL. The specification fixes no thickness
// for a marking: a build may mark a radiator with a fin, a bar, a row of pips or
// a shaded edge, at any depth into the footprint it likes. So the two faces are
// compared one unit-deep shell at a time, from just inside the footprint's own
// outline to eight units in, and the point holds if the two faces read plainly
// apart at ANY of those depths. Reading one thick band instead would average a
// thin fin away into the body behind it; reading only the outermost unit would
// fail a build whose fin sits a little further in.
//
// AND WHY IT COMPARES LIKE WITH LIKE. Each shell of the radiator face is
// compared against the shell of the plain face at the SAME depth, so the body
// cancels out of both. A build that marks nothing reads zero at every depth,
// because the two shells are then the same thing; a build that marks every face
// alike reads zero for the same reason; only a build that marks the radiator face
// differently from the plain one reads anything at all.
//
// WHAT IS COMPARED, AND WHY IT IS NEVER A COLOUR. specs/overview.md fixes no
// palette. What each shell contributes is the colour it MOSTLY reads as, and what
// is asserted is the distance between the two — a comparison between two things
// the same build drew on one tower.
//
// WHAT IT DOES NOT DECIDE. That the marked faces follow the placement rotation is
// `radiator-faces-follow-the-rotation`. Which faces a type HAS, and what they do
// to its heat, are `towers.radiator-faces` and the `heat` group's; nothing here
// reads a snapshot field.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  sizeOf,
  startRun,
  type Face,
  type Harness,
  type TowerType,
} from "../harness";
import { poseStillTower } from "./pose";
import { worldRadiators } from "./roster";
import { dominant, faceBand, readRegion, showRgb } from "./read";

/**
 * How far, out of the 441 the RGB cube spans, the radiator face must sit from
 * the plain face at the same depth, to count as a marking rather than more of the
 * same tower.
 *
 * The group's figure for two things a player tells apart at a glance, and the
 * same 50 every other point in this group draws its line at. "Drawn distinctly"
 * is the legibility table's own phrase, and this is what the group means by it.
 */
const APART_MIN = 50;

/**
 * How close two pixels of one shell must be to count as the same reading, when
 * the check asks what that shell mostly is.
 *
 * Half of `APART_MIN`, and the group's figure for two readings that are the same
 * thing rather than two things: a body shaded across its own area, a gradient, a
 * pixel softened where it meets an outline.
 */
const SAME_READING_MAX = 25;

/**
 * The tower the pair is read on, and where it stands.
 *
 * The Lance: specs/towers.md gives its radiators as local N and E, so at rotation
 * `0` exactly one of its two side faces is a radiator, and its 4x4 footprint is
 * the largest in the roster, which gives each shell the most of the build's own
 * drawing to read.
 */
const TYPE: TowerType = "lance";
const COL = 10;
const ROW = 10;
const ROTATION = 0;

/** The two faces read, at that rotation: the radiator, then the plain one. */
const RADIATOR_FACE: Face = "E";
const PLAIN_FACE: Face = "W";

/**
 * The depths into the footprint the two faces are compared at, in units.
 *
 * From one unit in — so the footprint's own outline and the anti-aliasing of it,
 * which sit on the boundary itself, are outside every reading — to eight, which
 * is deeper than any marking a build would call a face and still well inside the
 * smallest footprint in the roster.
 */
const DEPTHS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * What stretch of the face's own length each shell is read over.
 *
 * The middle two-fifths, so the corners this face shares with its neighbours are
 * not read as if they belonged to it.
 */
const ALONG_FROM = 0.3;
const ALONG_TO = 0.7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a radiator face apart from a plain face", async () => {
  startRun(h);
  poseStillTower(h, TYPE, COL, ROW, ROTATION);
  await h.advance(1);
  captureStill(h, "faces");

  const size = sizeOf(TYPE);
  const shell = (face: Face, depth: number) =>
    dominant(
      readRegion(
        h,
        faceBand(COL, ROW, size, face, depth, depth + 1, ALONG_FROM, ALONG_TO),
        1,
      ),
      SAME_READING_MAX,
    );

  let best = 0;
  let at = DEPTHS[0];
  let marked = shell(RADIATOR_FACE, at);
  let plain = shell(PLAIN_FACE, at);
  for (const depth of DEPTHS) {
    const radiator = shell(RADIATOR_FACE, depth);
    const bare = shell(PLAIN_FACE, depth);
    const apart = colorDistance(radiator, bare);
    if (apart > best) {
      best = apart;
      at = depth;
      marked = radiator;
      plain = bare;
    }
  }

  assertGreaterThanOrEqual(
    best,
    APART_MIN,
    `a ${TYPE} at rotation ${ROTATION}, whose world radiator faces are ` +
      `${worldRadiators(TYPE, ROTATION).join(" and ")} (specs/towers.md): the ` +
      `furthest its ${RADIATOR_FACE} face (${showRgb(marked)}) reads from its ` +
      `plain ${PLAIN_FACE} face (${showRgb(plain)}) at any one depth into the ` +
      `footprint, out of 441; the two were read one unit at a time from ` +
      `${DEPTHS[0]} to ${DEPTHS[DEPTHS.length - 1]} units in and this was ` +
      `their reading at ${at} (specs/overview.md: radiator faces are drawn ` +
      `distinctly from plain faces)`,
  );
});
