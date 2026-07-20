// Color: the worker renders in a distinct, visible hi-vis color, clearly different from the
// ground it stands on. The rendered pixels at the worker's body and at an empty ground patch
// are sampled from the actual canvas (not any reported value).

import { setTile, startFresh, settle, sampleColor, colorDistance, tileCenterX, tileCenterY } from "../_helpers.mjs";

const DISTINCT_MIN = 40;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.worker");

  await startFresh(api, 1);
  await setTile(api, 10, 12);
  await settle(api, 120);

  const wx = tileCenterX(10);
  const wy = tileCenterY(12);
  const worker = await sampleColor(api, wx, wy - 20); // the worker's body
  const ground = await sampleColor(api, wx + 120, wy); // an empty ground tile three columns over

  check.expectGt(
    "the worker is drawn in a color distinct from the ground",
    colorDistance(worker, ground),
    DISTINCT_MIN,
  );

  await api.screenshot("scene");
  return check.verdict();
}
