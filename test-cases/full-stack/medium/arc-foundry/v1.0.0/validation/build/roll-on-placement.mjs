// Automated validation for build.roll-on-placement: a rock rolls its component on placement
// (when it lands), not when the press is pulled.
//
// With the debug arming cleared (the real seeded press), a rock is placed under several
// different seeds; the placed candidate carries a rolled type, and the spread across seeds
// shows the roll is drawn at the drop (a deterministic function of the seed and the drop),
// not a fixed value.

import { startBuild, towerAt, snap, spawnControlled, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("build.roll-on-placement");

  const types = new Set();
  for (let seed = 1; seed <= 10; seed += 1) {
    await startBuild(api, { seed });
    await api.call("setNextRoll", null); // clear the arming: roll the real seeded press
    await api.call("placeRock", 6, 7);
    const t = towerAt(await snap(api), 6, 7);
    if (t && t.kind === "candidate") types.add(t.type);
  }
  check.expectGt("re-seeded placements roll a spread of component types on landing", types.size, 1);

  // A last placement + a walking unit for the clip.
  await api.call("setNextRoll", null);
  await spawnControlled(api, "spark");
  await liveClip(api);
  return check.verdict();
}
