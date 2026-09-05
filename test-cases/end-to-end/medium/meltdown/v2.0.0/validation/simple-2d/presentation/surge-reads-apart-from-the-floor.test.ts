// presentation/surge-reads-apart-from-the-floor — every surge type is drawn where
// it stands.
//
// THE RULE. specs/overview.md's legibility table: "Ground units, flyers, and the
// boss read apart from one another, from the floor, and from every color a tower
// shows anywhere on its heat ramp." What a check can decide of that is presence:
// each of the six types specs/surge.md rosters is drawn on the tile it stands on.
// How far apart the six read from one another and from the floor is appearance,
// which the palette clause of the same specification hands to the build: "The
// palette, the type, the glow, and every other aspect of the look are yours."
//
// HOW A UNIT IS READ. A unit reports its CENTRE (specs/instrumentation.md), and
// the centre is the one part of a unit every build draws whatever shape it chose,
// so the reading is taken there: the centre pixel and four neighbours two units
// out, which is `spotColor` in presentation/read.ts and is deliberately tighter
// than the harness's tile-scale `sampleColor` — a Swarm is smaller than a tile,
// and a cluster three units either side would blur the floor into it.
//
// WHY THE READING IS A REMOVAL. specs/instrumentation.md gives `clearSurge`, so
// the centre is read with the unit standing on it and again with the surge taken
// away, and the unit is what disappeared. The floor art under it, the grid line
// specs/floor.md puts on every tile boundary, and anything else the build laid
// there are identical in the two frames and cancel exactly. How much the picture
// moves on its own is measured first, by reading the same centres on two frames
// with the surge standing, and the removal has to beat that by `NOISE_MARGIN`.
//
// THE FLOOR IS POSED BARE. `startRun` opens on an empty floor with the run's own
// release of surge held, and each unit is posed standing still with its motion
// off, so nothing walks out of the tile it was read on and nothing arrives that
// the check did not ask for.
//
// WHAT IT DOES NOT DECIDE. What each type is worth, how fast it walks and how
// much it carries are the `surge` group's; the health bar over a unit is
// `hud.unit-health-bars`. Nothing here asserts a size, a shape or a colour.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { SURGE_TYPES } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseTarget,
  startRun,
  unitOf,
  type Harness,
} from "../harness";
import { NOISE_MARGIN, spotColor } from "./read";

/** The row the six stand on, the pitch between them, and the first column. */
const SURGE_ROW = 8;
const SURGE_COL0 = 5;
const SURGE_PITCH = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every surge type on the tile it stands on", async () => {
  startRun(h);
  const ids = SURGE_TYPES.map((type, index) =>
    poseTarget(h, type, SURGE_COL0 + index * SURGE_PITCH, SURGE_ROW),
  );
  await h.advance(1);

  const snapshot = h.snapshot();
  const centres = ids.map((id) => {
    const unit = unitOf(snapshot, id);
    return { x: unit.x, y: unit.y };
  });

  const first = centres.map((at) => spotColor(h, at.x, at.y));
  await h.advance(1);
  const second = centres.map((at) => spotColor(h, at.x, at.y));
  captureStill(h, "surge");

  h.debug.clearSurge();
  await h.advance(1);
  const cleared = centres.map((at) => spotColor(h, at.x, at.y));

  SURGE_TYPES.forEach((type, index) => {
    const noise = colorDistance(first[index], second[index]);
    assertGreaterThanOrEqual(
      colorDistance(second[index], cleared[index]),
      noise + NOISE_MARGIN,
      `a ${type} on tile (${SURGE_COL0 + index * SURGE_PITCH}, ` +
        `${SURGE_ROW}): the patch on its centre changes when the surge is ` +
        `taken away, by more than the ${noise} two frames with it standing ` +
        `moved on their own (specs/overview.md: the surge reads apart from ` +
        `the floor)`,
    );
  });
});
