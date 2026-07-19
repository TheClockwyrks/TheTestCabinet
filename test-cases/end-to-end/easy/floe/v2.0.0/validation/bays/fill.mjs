// Automated validation for the Bays item `fill`.
//
// Hopping up into an open far-shore bay completes the crossing, fills the bay, and
// scores. The critter is stood on a floe below bay 0 and a real up-hop fills it,
// which the snapshot reads back. See validation/_helpers.mjs.

import { startCrossing, WATER_TOP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("bays.fill");

  await startCrossing(api);
  await api.call("setScore", 0);
  await api.call("setLane", WATER_TOP, { cols: [3], speed: 0 }); // floe below bay 0
  await api.call("placeCritter", 3, WATER_TOP);
  check.expectEq("bay 0 starts open", (await api.snapshot()).bays[0], false);

  await api.call("press", "ArrowUp");
  await api.step(0.2);
  const s = await api.snapshot();
  check.expectEq("hopping up into an open bay fills it", s.bays[0], true);
  check.expectGt("filling a bay awards score", s.score, 0);

  // Clip: the crossing completed into the bay in real time.
  await startCrossing(api);
  await api.call("setLane", WATER_TOP, { cols: [3], speed: 0 });
  await api.call("placeCritter", 3, WATER_TOP);
  await api.wait(250);
  await api.call("press", "ArrowUp");
  await api.wait(700);

  return check.verdict();
}
