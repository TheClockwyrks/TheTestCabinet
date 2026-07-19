// Automated validation for the Hunter item `swims`.
//
// Over open water the bear swims, and it moves slower swimming than it does on ice.
// A bear is placed on cleared open water (swimming) and then on cleared ice, and
// its per-step displacement toward the same target is compared. See _helpers.mjs.

import { startCrossing, WATER_TOP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hunter.swims");

  await startCrossing(api);
  await api.call("setLane", WATER_TOP, { cols: [20], speed: 0 }); // safe target up top for the critter
  await api.call("placeCritter", 20, WATER_TOP);
  for (const r of [4, 5, 6]) await api.call("setLane", r, { cols: [] }); // open water
  await api.call("setBear", 0, { col: 20, row: 6 });

  await api.step(0.08); // let the bear commit a step (swimming set from its footing)
  check.expectEq("the bear over open water is swimming", (await api.snapshot()).bears[0].swimming, true);
  const yA = (await api.snapshot()).bears[0].y;
  await api.step(0.15);
  const swimDisp = Math.abs((await api.snapshot()).bears[0].y - yA);

  // Now the same pursuit on ice.
  for (const r of [13, 14, 15]) await api.call("setLane", r, { cols: [] });
  await api.call("setBear", 0, { col: 20, row: 15 });
  await api.step(0.08);
  check.expectEq("the bear on ice is not swimming", (await api.snapshot()).bears[0].swimming, false);
  const yB = (await api.snapshot()).bears[0].y;
  await api.step(0.15);
  const iceDisp = Math.abs((await api.snapshot()).bears[0].y - yB);

  check.expectLt("swimming is slower than moving on ice", swimDisp, iceDisp);

  // Clip: the bear swimming out after the critter in real time.
  await startCrossing(api);
  await api.call("setLane", WATER_TOP, { cols: [20], speed: 0 });
  await api.call("placeCritter", 20, WATER_TOP);
  for (const r of [4, 5, 6]) await api.call("setLane", r, { cols: [] });
  await api.call("setBear", 0, { col: 20, row: 6 });
  await api.call("setAutoStep", true);
  await api.wait(1500);

  return check.verdict();
}
