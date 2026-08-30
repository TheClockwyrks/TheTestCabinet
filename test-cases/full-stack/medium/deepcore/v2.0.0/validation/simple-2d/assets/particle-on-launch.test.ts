// assets/particle-on-launch — the exhaust column plays under the rising rocket.
//
// `specs/assets.md`: `launch-exhaust.json` fires when "The rocket launches" and
// carries "A roaring column of exhaust and smoke under the rising rocket".
// `specs/rocket.md` fixes what launching is: with all five components installed,
// `LAUNCH` plays the rocket lifting off the pad with the produced launch-exhaust
// effect.
//
// So the drawing around the pad's base is counted over the launch-ready camp, and
// again once `launch` has been run. The pad's footprint comes from `buildings()`
// rather than from a layout this check invented, because `specs/world.md` leaves
// where the six sit to the build.
//
// The five components are posed installed rather than bought, so the reading is
// about the launch and not about the economy, and nothing else in the camp is
// running: the mine is cleared, the drill is held, and no key is down.

import { afterEach, beforeEach, it } from "vitest";
import { ROCKET_COMPONENTS, TILE } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtBuilding,
  worldToStage,
  type Harness,
} from "../harness";
import { peakNear } from "./effects";

/** Frames each reading is taken over. */
const BEFORE_FRAMES = 12;
const AFTER_FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ assets: true });
});

afterEach(() => {
  h?.dispose();
});

it("draws more under the pad once the rocket launches", async () => {
  openScene(h);
  layCamp(h);
  pinDrill(h);
  const pad = standAtBuilding(h, "launch-pad");
  h.debug.setPanel(null);
  h.debug.setRocketInstalled(ROCKET_COMPONENTS.length);
  await h.advance(2);

  const snapshot = h.snapshot();
  const base = worldToStage(snapshot, pad.x + pad.w / 2, pad.y + pad.h);
  const where = (): { x: number; y: number } => base;

  const before = await peakNear(h, BEFORE_FRAMES, TILE * 3, where);

  const launched = await captureReplay(h, "column", async () => {
    h.debug.launch();
    const peak = await peakNear(h, AFTER_FRAMES, TILE * 3, where);
    return { peak, snapshot: h.snapshot() };
  });

  assertEqual(
    launched.snapshot.rocket.installed.length,
    ROCKET_COMPONENTS.length,
    "specs/rocket.md",
  );
  assertGreaterThan(launched.peak, before, "specs/assets.md");
});
