// presentation/heat-glow-ramp — an emitter is drawn differently at the two ends
// of its heat range.
//
// THE RULE. `specs/overview.md`'s legibility table: "An emitter's drawn color
// tracks its heat along a ramp, and the cold end and the near-redline end read
// plainly apart." What a check can decide of that is that the build draws the
// heat AT ALL: the same tower, on the same tile, at the cold end of the range and
// at the near-redline end, is drawn differently. How far apart the two ends read
// and what shape the ramp between them takes are appearance, which the same
// specification hands to the build — "The palette, the type, the glow, and every
// other aspect of the look are yours" — and the reviewer judges.
//
// THE ONE VARIABLE. Both readings are of the SAME tower, on the same tile, at the
// same type, level and rotation, with nothing between them but `setTowerHeat`.
// Everything else the build drew on that patch is identical in the two frames and
// cancels, so what is left is the heat. How much the picture moves on its own is
// measured first, by reading the same points on two frames at the cold end, and
// the change has to beat that by `NOISE_MARGIN`.
//
// WHERE THE READING IS TAKEN. The body ring of `read.ts`, on a Lance, whose 4x4
// footprint (`specs/towers.md`) is the roomiest body in the roster: the ring sits
// clear of the faces, where `specs/towers.md` puts the radiator marking, and clear
// of the centre, where `specs/hud.md` lets a build put a heat read. That last one
// is why the ring and not the whole footprint — a build is free to put its heat
// read on the footprint, `hud/on-floor-heat-read` is the item that grades it, and
// a reading over the whole footprint would pass on that read alone.
//
// WHY THE TOWER IS PINNED. `posePinnedTower` holds its thermal model
// (`specs/instrumentation.md`), so the heat this check posed is the heat the frame
// drew, rather than a heat that decayed by air cooling between the pose and the
// render.
//
// WHAT IT DOES NOT DECIDE. Whether the heat READ on the footprint tracks the heat
// is `hud/on-floor-heat-read`'s item, and whether a TRIPPED tower is drawn apart
// from an online one is `presentation/tripped-reads-apart`'s. This item is the
// body of an online emitter at the two ends of its range, and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { TRIP_HEAT } from "../constants";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";
import { NOISE_MARGIN, bodyPoints, readPixels, widestGap } from "./read";

/**
 * The two heats the body is read at.
 *
 * `specs/heat.md` puts heat on `0` to `TRIP_HEAT` (`100`), and 99 rather than 100
 * is the top because 100 is the trip's own crossing value and a tower drawn there
 * is what `presentation/tripped-reads-apart` is about.
 */
const COLD = 0;
const HOT = TRIP_HEAT - 1;

/** Where the Lance stands: clear of the casing, the openings and both corridors. */
const AT = { col: 10, row: 6 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws an emitter differently at the two ends of its heat range", async () => {
  await startRun(h);
  const id = await posePinnedTower(h, "lance", AT.col, AT.row, COLD);
  await h.debug.setTowerFiring(id, false);
  await h.advance(1);

  const ring = bodyPoints(requireTower(await h.snapshot(), id, "the Lance"));
  const first = await readPixels(h, ring);
  await h.advance(1);
  const second = await readPixels(h, ring);
  const noise = widestGap(first, second).distance;

  await h.debug.setTowerHeat(id, HOT);
  await h.advance(1);
  await captureStill(h, "ramp");
  const hot = await readPixels(h, ring);

  assertGreaterThanOrEqual(
    widestGap(second, hot).distance,
    noise + NOISE_MARGIN,
    `a Lance on tile (${AT.col}, ${AT.row}): its body ring is drawn ` +
      `differently at heat ${HOT} from at heat ${COLD}, by more than the ` +
      `${noise} two frames at heat ${COLD} moved on their own ` +
      `(specs/overview.md: an emitter's drawn color tracks its heat along a ` +
      `ramp, and the cold end and the near-redline end read plainly apart)`,
  );
});
