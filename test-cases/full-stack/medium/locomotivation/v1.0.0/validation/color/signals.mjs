// Color: a crossing signal renders a clearly different color for its clear state than for
// its danger state. Level 1's signal (3,7) is sampled clear (no train), then a real train is
// posed upon its crossing so the same signal shows danger; the two rendered colors differ.

import { startFresh, settle, sampleColor, colorDistance, tileCenterX, tileCenterY } from "../_helpers.mjs";

const DISTINCT_MIN = 40;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.signals");

  await startFresh(api, 1);
  const hx = tileCenterX(3);
  const hy = tileCenterY(7) - 24; // the signal head

  await settle(api, 120);
  const clear = await sampleColor(api, hx, hy);

  // Pose a commuter straddling the row-8 crossing the signal watches (no step, so it stays put).
  await api.call("spawnTrain", { line: 8, orientation: "horizontal", dir: "east", kind: "commuter", headPos: 200 });
  await settle(api, 120);
  const danger = await sampleColor(api, hx, hy);

  check.expectGt("clear and danger signal colors differ", colorDistance(clear, danger), DISTINCT_MIN);

  await api.screenshot("scene");
  return check.verdict();
}
