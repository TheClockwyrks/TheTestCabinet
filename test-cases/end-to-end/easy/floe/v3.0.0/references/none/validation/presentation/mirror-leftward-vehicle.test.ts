// presentation/mirror-leftward-vehicle — a vehicle in a lane that runs leftward
// is drawn mirrored, and the same vehicle in a lane that runs rightward is not.
//
// specs/assets.md: "Each vehicle's art faces right. A vehicle in a lane whose
// `dir` is `-1` is drawn mirrored horizontally, so every vehicle faces the way
// its lane runs. The bear and the floes are never mirrored". So the requirement
// is a relation between the lane's direction and the drawn orientation, and it
// is read here on ONE KIND in TWO LANES: a car on row `12`, which specs/ice.md
// runs rightward, and a car on row `15`, which it runs leftward.
//
// ONE KIND IN BOTH LANES IS WHAT MAKES THE READING A MIRROR RATHER THAN A
// DIFFERENCE. Two kinds could differ in orientation because their art differs;
// the same kind can only differ because the build mirrored one of them. And both
// halves are asserted in their own direction: a build that mirrors every vehicle
// faces its rightward traffic backwards and fails the rightward half, while a
// build that mirrors none fails the leftward half. A single "they differ" check
// would pass the first of those.
//
// WHAT IS READ IS THE DESTINATION BOX, THROUGH THE TRANSFORM IN FORCE. A build
// may mirror with a negative scale around a translated origin or with a negative
// destination width; both reverse the mapped box's corners, and that reversal is
// what `flipX` reports. The lane directions are read off the snapshot first, as
// the situation rather than the requirement: the two rows must really be the
// opposite-running pair specs/ice.md lays out, or there is no mirror to read.
//
// The lanes are held still by `poseLane` and the strait is otherwise empty, so
// each car sits on the column it was given and the two draws are told apart by
// the three rows between them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { TILE } from "../constants";
import {
  blitsOfFrame,
  captureStill,
  createHarness,
  drawnFrom,
  type Harness,
  itemArtCentre,
  laneAt,
  poseLane,
  requireItem,
  startCrossing,
} from "../harness";

/** A car lane specs/ice.md runs rightward, and one it runs leftward. */
const RIGHTWARD_ROW = 12;
const LEFTWARD_ROW = 15;

/** Where each car's left edge is put: two whole tiles, well inside the strait. */
const COL = 10;

/**
 * How far a draw's centre may sit from the centre of the box its tiles span.
 *
 * Half a tile: the widest tolerance that still names one span. The two cars are
 * three rows — 96 units — apart, so neither draw can be mistaken for the other.
 */
const CENTRED_WITHIN = TILE / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("mirrors the car in the leftward lane and not the one in the rightward lane", async () => {
  await startCrossing(h);
  const [rightward] = await poseLane(h, RIGHTWARD_ROW, "car", [COL]);
  const [leftward] = await poseLane(h, LEFTWARD_ROW, "car", [COL]);

  const blits = await blitsOfFrame(h);
  const scene = await h.snapshot();
  await captureStill(h, "scene");

  // The situation: the two rows really are the opposite-running pair.
  assertEqual(
    laneAt(scene, RIGHTWARD_ROW)?.dir,
    1,
    `row ${RIGHTWARD_ROW} runs rightward (specs/ice.md)`,
  );
  assertEqual(
    laneAt(scene, LEFTWARD_ROW)?.dir,
    -1,
    `row ${LEFTWARD_ROW} runs leftward (specs/ice.md)`,
  );

  const draws = (id: number, row: number) => {
    const item = requireItem(scene, id, `the car on row ${row}`);
    const found = drawnFrom(blits, "car", itemArtCentre(item), CENTRED_WITHIN);
    assertGreaterThanOrEqual(
      found.length,
      1,
      `the car on row ${row} drawn from assets/car/0.png (specs/assets.md)`,
    );
    return found[0];
  };

  assertEqual(
    draws(rightward, RIGHTWARD_ROW).flipX,
    false,
    `the car in the rightward lane drawn unmirrored — the seeded art already ` +
      `faces right (specs/assets.md)`,
  );
  assertEqual(
    draws(leftward, LEFTWARD_ROW).flipX,
    true,
    `the car in the leftward lane drawn mirrored horizontally, so it faces the ` +
      `way its lane runs (specs/assets.md)`,
  );
});
