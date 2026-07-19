// Automated validation for the Surface-cooling sub-item `open-faces-shed`.
//
// A hot tower with faces on open air sheds heat over time (specs/heat.md). A lone
// emitter is posed hot as a precondition, then the real cooling model is stepped
// forward with no target — its heat must fall.

import { newGame, build, heatOf, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cooling.open-faces-shed");

  await newGame(api, "containment", "medium", 100000);
  const id = await build(api, "arc", 20, 12);
  await api.call("setHeat", id, 80);
  const before = await heatOf(api, id);

  await api.step(2); // no target: the tower only cools
  const after = await heatOf(api, id);

  check.expectClose("the emitter starts hot", before, 80, 0.5);
  check.expectLt("a lone hot emitter sheds heat over time", after, before);

  // A clip: a lone hot tower cooling off (its glow dimming).
  await newGame(api, "containment", "medium", 100000);
  const c = await build(api, "arc", 20, 12);
  await api.call("setHeat", c, 92);
  await liveClip(api, 1800);
  return check.verdict();
}
