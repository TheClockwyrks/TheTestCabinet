// visibility/deflector-apart-from-field — the deflector is drawn on its track.
//
// WHAT THE SPECIFICATION FIXES. The review item: "The deflector is drawn on its
// track between radii 170 and 186, across the span it holds." The radii are
// `specs/field.md`'s: "Deflector track | Annulus from radius 170 to 186." The
// palette is the build's own, so what is read is presence alone: the footprint
// the deflector occupies is rendered twice, once with the deflector standing
// there and once with it steered to the far side of the track, and the points
// that moved between the two frames are the points it was drawn on.
//
// THE WORLD THIS POSES. An isolated `playing` field: no targets, no balls, no
// pods, both driver switches held. The deflector is the one thing the
// requirement is about and it is always present, standing at its start angle
// `90` with its baseline span of `48` degrees
// (`specs/deflector-and-ball.md`), and `setPaddleAngle` steers it to `270` for
// the second frame — an angle the same file allows it anywhere on its track.
//
// WHERE IT SAMPLES. Five angles inside the span, and at each of them every
// whole radius strictly inside the track annulus, so a deflector drawn as an
// arc of any weight lands on some sampled point at every one of those angles.
// Each angle is read on its own, so a deflector drawn across only part of its
// span does not pass on the rest.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  PADDLE_START_ANGLE,
  TRACK_INNER_RADIUS,
  TRACK_OUTER_RADIUS,
} from "../constants";
import {
  captureStill,
  isolate,
  openHarness,
  samplePoints,
  type Harness,
  type Rgb,
} from "../harness";
import { movedCount, polarGrid, polarPoints } from "./sampling";

/** Every whole radius strictly inside the track annulus. */
const TRACK_RADII = Array.from(
  { length: TRACK_OUTER_RADIUS - TRACK_INNER_RADIUS - 1 },
  (_, i) => TRACK_INNER_RADIUS + 1 + i,
);

/** Angles inside the baseline span (66 to 114 degrees), 4 in from each edge. */
const SPAN_ANGLES = [70, 80, PADDLE_START_ANGLE, 100, 110];

/** Where the deflector is steered for the second frame: the far side. */
const AWAY_ANGLE = PADDLE_START_ANGLE + 180;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the deflector across its span on the track", async () => {
  await isolate(h);
  await h.tick(1);
  await captureStill(h, "scene");

  const columns = SPAN_ANGLES.map((theta) =>
    polarPoints(polarGrid(TRACK_RADII, [theta])),
  );
  const standing: Rgb[][] = [];
  for (const points of columns) standing.push(await samplePoints(h, points));

  await h.debug.setPaddleAngle(AWAY_ANGLE);
  await h.tick(1);
  const steered: Rgb[][] = [];
  for (const points of columns) steered.push(await samplePoints(h, points));

  for (let i = 0; i < SPAN_ANGLES.length; i += 1) {
    assertGreaterThan(
      movedCount(standing[i], steered[i]),
      0,
      `the sampled points of the track at ${SPAN_ANGLES[i]} degrees the ` +
        `deflector was drawn on`,
    );
  }
});
