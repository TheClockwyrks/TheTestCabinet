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
// shade, an outline, a bevel — lands identically in both and cannot decide the
// comparison, and the only thing that can is a marking the build put on one face
// and not the other. The N and S faces are deliberately not the pair: specs/hud.md
// asks every tower to carry a heat read ON its footprint, a build is free to lay
// that along the top or the bottom edge, and a reading that ran through it would
// be reading the heat read rather than a face.
//
// WHERE THE BAND SITS. Three to seven units in from the edge, over the middle
// two-fifths of the face's length. It starts three units in so the footprint's
// own outline and the anti-aliasing of it are outside the reading; it runs to
// seven so a marking of any ordinary thickness falls inside it; and it takes the
// middle of the face so the corners this face shares with its neighbours are not
// read as if they belonged to it.
//
// WHAT IS COMPARED, AND WHY IT IS NEVER A COLOUR. specs/overview.md fixes no
// palette. The check reads what the PLAIN face mostly is, then asks how much of
// the radiator face is drawn plainly apart from that. A build that marks nothing
// reads zero, because both bands are the same thing; a build that marks every
// face alike reads zero for the same reason; only a build that marks the radiator
// face and not the plain one reads anything at all.
//
// WHAT IT DOES NOT DECIDE. That the marked faces follow the placement rotation is
// `radiator-faces-follow-the-rotation`. Which faces a type HAS, and what they do
// to its heat, are `towers.radiator-faces` and the `heat` group's; nothing here
// reads a snapshot field.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { sizeOf, worldRadiators } from "../geometry";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import type { Face, TowerType } from "../surface";
import { poseStillTower } from "./pose";
import { apartFraction, dominant, faceBand, readRegion, showRgb } from "./read";

/**
 * How far, out of the 441 the RGB cube spans, a pixel of the radiator face must
 * sit from what the plain face reads as, to count as a marking rather than more
 * of the same tower.
 *
 * The suite's figure for two things a player tells apart at a glance, and the
 * same 50 every other point in this group draws its line at. "Drawn distinctly"
 * is the legibility table's own phrase, and this is what the group means by it.
 */
const APART_MIN = 50;

/**
 * How much of the radiator face's band must carry that marking.
 *
 * A quarter. The band is five units deep, so this asks the marking to be a good
 * unit or more of it — which is the thinnest line a player could pick out on a
 * tower at this stage size — while leaving a build free to mark its radiator with
 * a fin, a bar, a row of pips or a shaded edge rather than with a full-depth
 * block.
 */
const MARK_MIN = 0.25;

/**
 * How close two pixels of the plain face must be to count as the same reading,
 * when the check asks what the plain face mostly is.
 *
 * Half of `APART_MIN`, and the suite's figure for two readings that are the same
 * thing rather than two things: a body shaded across its own area, a gradient, a
 * pixel softened where it meets an outline.
 */
const SAME_READING_MAX = 25;

/**
 * The tower the pair is read on, and where it stands.
 *
 * The Lance: specs/towers.md gives its radiators as local N and E, so at rotation
 * `0` exactly one of its two side faces is a radiator, and its 4x4 footprint is
 * the largest in the roster, which gives each band the most of the build's own
 * drawing to read.
 */
const TYPE: TowerType = "lance";
const COL = 10;
const ROW = 10;
const ROTATION = 0;

/** The two faces read, at that rotation: the radiator, then the plain one. */
const RADIATOR_FACE: Face = "E";
const PLAIN_FACE: Face = "W";

/** How deep into the footprint each band runs, and what stretch of the face. */
const BAND_FROM = 3;
const BAND_TO = 7;
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
  const band = (face: Face) =>
    readRegion(
      h,
      faceBand(COL, ROW, size, face, BAND_FROM, BAND_TO, ALONG_FROM, ALONG_TO),
      1,
    );

  const plain = dominant(band(PLAIN_FACE), SAME_READING_MAX);
  const marked = apartFraction(band(RADIATOR_FACE), plain, APART_MIN);

  assertGreaterThanOrEqual(
    marked,
    MARK_MIN,
    `a ${TYPE} at rotation ${ROTATION}, whose world radiator faces are ` +
      `${worldRadiators(TYPE, ROTATION).join(" and ")} (specs/towers.md): the ` +
      `proportion of its ${RADIATOR_FACE} face drawn at least ${APART_MIN} of ` +
      `441 from what its plain ${PLAIN_FACE} face reads as ` +
      `(${showRgb(plain)}), both read ${BAND_FROM} to ${BAND_TO} units inside ` +
      `the footprint (specs/overview.md: radiator faces are drawn distinctly ` +
      `from plain faces)`,
  );
});
