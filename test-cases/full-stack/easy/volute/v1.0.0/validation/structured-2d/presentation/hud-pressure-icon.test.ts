// presentation/hud-pressure-icon — the HUD's gauge is marked with the produced
// pressure icon.
//
// THE REQUIREMENT. `specs/ui.md` — "The HUD": "Pressure | A gauge marked with the
// produced pressure icon, filled in proportion to the current pressure: empty at
// `0`, full at `100`." `specs/assets.md` fixes the icon's file: "pressure icon |
// 24 x 24", one of the two produced icons the HUD carries.
//
// WHY IT IS A POINT OF ITS OWN. A gauge that fills correctly with no produced
// icon on it, and a produced icon over a gauge that ignores the pressure, are two
// different builds and two different pieces of work: one skipped an asset the
// case asked it to produce, the other skipped a readout. One point cannot tell
// the two apart, so the fill is `presentation/hud-pressure-fill`'s point and the
// icon is this one.
//
// HOW THE ICON IS FOUND WITHOUT READING A PATH. `specs/assets.md` gives the HUD
// exactly two produced icons, the cell icon and the pressure icon, both 24 x 24,
// and `specs/ui.md` has the HUD carry both. So the frame is asked how many
// DISTINCT produced 24 x 24 sources it drew, told apart by the IDENTITY of the
// image rather than by a path — a bundler inlines a small produced PNG as a
// `data:` URI, which is still the committed file. A frame that draws only one
// distinct 24 x 24 source is missing one of the two, and which one the cell
// readout draws is `presentation/hud-cells`' point.
//
// AT WHAT PRESSURE. `PRESSURE_MIN`, the empty gauge. The icon MARKS the gauge, so
// it stands there whether or not the gauge has anything in it, and a build that
// draws its icon only once there is fill under it is exactly what this reading
// catches.
//
// TOLERANCE. None: the reading is a count of distinct produced sources.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { HUD_ICON_SPRITE, PRESSURE_MIN } from "../constants";
import {
  captureStill,
  createHarness,
  poseHall,
  type Harness,
} from "../harness";
import { drawCounts, hudIconDraws } from "./readouts";

/** Where the one core stands, in units from the inlet. */
const CORE_S = 1000;

/** Ticks run after the pose, so a HUD a build chose to ease has arrived. */
const SETTLE_TICKS = 6;

/** The produced icons `specs/assets.md` gives the HUD: the cell one and this one. */
const HUD_ICONS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("marks the HUD's gauge with a produced pressure icon", async () => {
  await poseHall(h, {
    level: 1,
    pressure: PRESSURE_MIN,
    cores: [[CORE_S, "halide", null]],
  });
  await h.step(SETTLE_TICKS);
  captureStill(h, "icon");

  const icons = drawCounts(hudIconDraws(h.lastCalls())).size;
  assertGreaterThanOrEqual(
    icons,
    HUD_ICONS,
    `distinct produced ${HUD_ICON_SPRITE} x ${HUD_ICON_SPRITE} icons on the HUD at a pressure of ${PRESSURE_MIN}`,
  );
});
