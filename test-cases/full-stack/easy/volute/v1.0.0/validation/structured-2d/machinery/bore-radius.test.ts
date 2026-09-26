// machinery/bore-radius — a bore clears every core within 90 units of the
// extraction point, and leaves the next one standing.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("Bore"): "The **extraction point**
// is the field position the marked core held at the moment its run was
// extracted, and bore removes every core whose center lies within `BORE_RADIUS`
// of that point, measured as straight-line distance across the field." And ("The
// four kinds") `BORE_RADIUS` is 90. `specs/channel.md` ("The order of a tick")
// puts the bore after the removal that granted it: step 4, resolving "against
// the positions that removal left".
//
// HOW THE BORE IS REACHED, and why every core it measures keeps the arc position
// it was posed at, are in `machinery/bore.ts`, which both bore points share.
// Nothing else is in the hall: no timed machinery is granted, since what a bore
// does to one is `machinery/bore-takes-no-slot`'s requirement and not this
// point's.
//
// THE TOLERANCE. None on the radius: the check asserts PRESENCE rather than a
// distance, and the arrangement's own margin is asserted rather than argued —
// {@link RADIUS_MARGIN} is the least each core may stand from the 90-unit bound,
// and the check fails the item if the pose it built does not clear it, so no
// core is ever classified from a distance the geometry left ambiguous. A core is
// matched to its posed arc position within the case's standing arc tolerance of
// 0.5 units.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { ARC_TOL, BORE_RADIUS, SPACING } from "../constants";
import {
  arcPositions,
  captureReplay,
  channelPoint,
  createHarness,
  distance,
  type Harness,
} from "../harness";
import {
  CLOSER_MERGED_S,
  HEAD_S,
  LEAD,
  MARKED_S,
  TRAILING_TICKS,
  driveBore,
  poseBoreHall,
} from "./bore";

/**
 * The least a core may stand from the 90-unit bound for the pose to be read.
 *
 * The pose lays the segment across a vertex so the nearest pair straddling the
 * radius sits about eleven units either side of it. Ten is that arrangement with
 * a unit of slack, and it is asserted rather than assumed: a build whose advance
 * carried the train further than the specification's own rates allow would fail
 * the item here, on the arrangement, rather than be graded on a classification
 * the geometry no longer decides.
 */
const RADIUS_MARGIN = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`clears every core within ${BORE_RADIUS} units of the extraction point and leaves the next one standing`, async () => {
  await poseBoreHall(h);

  const swept = await captureReplay(h, "bore", async () => {
    const merged = await driveBore(h);
    await h.step(TRAILING_TICKS);
    return merged;
  });

  // The whole lead segment rode the same arc while the drive ran, and its head is
  // far outside the radius, so what the head gained is what every core gained.
  const standing = arcPositions(swept.snapshot);
  const advance = Math.max(...standing) - HEAD_S;
  assertLessThan(
    Math.abs(advance),
    SPACING / 2,
    "the arc the surviving head rode, which identifies it as the core posed at the head",
  );

  const extraction = channelPoint(MARKED_S + advance);
  const posed: { s: number; label: string }[] = [
    ...LEAD.map(([s]) => ({ s, label: `posed at arc ${s}` })),
    { s: CLOSER_MERGED_S, label: "the core the merge brought in" },
  ];

  let expectedSurvivors = 0;
  for (const core of posed) {
    const at = core.s + advance;
    const away = distance(channelPoint(at), extraction);
    // The arrangement decides this core unambiguously, or the item fails on the
    // arrangement rather than on a reading the geometry left open.
    assertGreaterThan(
      Math.abs(away - BORE_RADIUS),
      RADIUS_MARGIN,
      `how far ${core.label} stands from the ${BORE_RADIUS}-unit bound`,
    );
    const present = standing.some((s) => Math.abs(s - at) <= ARC_TOL);
    const inside = away < BORE_RADIUS;
    if (!inside) expectedSurvivors += 1;
    assertEqual(
      present,
      !inside,
      `whether the core ${away.toFixed(1)} units from the extraction point (${core.label}) is still on the channel`,
    );
  }

  assertEqual(
    standing.length,
    expectedSurvivors,
    "the cores left standing once the extraction and its bore had resolved",
  );
});
