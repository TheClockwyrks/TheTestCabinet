// visibility/deflector-apart-from-field — the deflector is not the color of
// the track region behind it.
//
// WHAT THE SPECIFICATION FIXES. The review item: "The deflector, drawn on its
// track between radii 170 and 186, stands apart from the field behind it, so
// its position is read at a glance." The radii are `specs/field.md`'s:
// "Deflector track | Annulus from radius 170 to 186." The palette is the
// build's own, so what is read is separation alone, against the category's
// figure for clearly apart (`DISTINCT_MIN`, see `visibility/distinct.ts`).
//
// THE WORLD THIS POSES. An isolated `playing` field: no targets, no balls, no
// pods, both driver switches held. The deflector is the one thing the
// requirement is about and it is always present, standing at its start angle
// `90` with its baseline span of `48` degrees (`specs/deflector-and-ball.md`).
//
// WHERE IT SAMPLES. Fifteen points across the deflector's own footprint —
// three radii inside the track annulus by five angles inside the span — and,
// for the field behind it, five points at the track's mid radius at angles far
// from the span: the very region the deflector would occupy had it been
// steered there, which is exactly what "the field behind it" looks like. The
// deflector passes when some point of its footprint is clearly apart from
// every one of those field samples.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  DEFLECTOR_START_ANGLE_DEG,
  DEFLECTOR_TRACK_INNER,
  DEFLECTOR_TRACK_OUTER,
} from "../constants";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import {
  DISTINCT_MIN,
  polarGrid,
  polarPoints,
  samplePoints,
  separation,
} from "./distinct";

/** Radii inside the track annulus: 2 units in from each edge, and the mid. */
const TRACK_RADII = [DEFLECTOR_TRACK_INNER + 2, 178, DEFLECTOR_TRACK_OUTER - 2];

/** Angles inside the baseline span (66 to 114 degrees), 4 in from each edge. */
const SPAN_ANGLES = [70, 80, DEFLECTOR_START_ANGLE_DEG, 100, 110];

/** The field at the deflector's radius, far from the span. */
const FIELD_ANGLES = [0, 180, 225, 270, 315];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the deflector apart from the empty track region", async () => {
  isolate(h);
  await h.tick(1);
  captureStill(h, "scene");

  const deflector = samplePoints(
    h,
    polarPoints(polarGrid(TRACK_RADII, SPAN_ANGLES)),
  );
  const field = samplePoints(h, polarPoints(polarGrid([178], FIELD_ANGLES)));

  assertGreaterThan(
    separation(deflector, field),
    DISTINCT_MIN,
    "the RGB separation of the deflector's footprint from the track region " +
      "away from its span",
  );
});
