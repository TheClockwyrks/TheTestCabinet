// Automated validation for the Bays item `layout`.
//
// There are five bays, each enterable at its own far-shore column, with solid
// shore between them that cannot be entered. Each bay is confirmed by a real hop
// up from a floe below its column filling that bay; a solid-shore column refuses
// the same hop. See validation/_helpers.mjs.

import { startCrossing, BAY_LEFT, WATER_TOP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("bays.layout");

  for (let i = 0; i < BAY_LEFT.length; i += 1) {
    const col = BAY_LEFT[i];
    await startCrossing(api);
    await api.call("setBays", [false, false, false, false, false]);
    await api.call("setLane", WATER_TOP, { cols: [col], speed: 0 });
    await api.call("placeCritter", col, WATER_TOP);
    await api.call("press", "ArrowUp");
    await api.step(0.15);
    check.expectEq(`bay ${i} is enterable at column ${col}`, (await api.snapshot()).bays[i], true);
  }

  // A solid-shore column between bays refuses the hop.
  await startCrossing(api);
  await api.call("setLane", WATER_TOP, { cols: [8], speed: 0 });
  await api.call("placeCritter", 8, WATER_TOP);
  await api.call("press", "ArrowUp");
  await api.step(0.15);
  check.expectEq("the solid shore between bays cannot be entered", (await api.snapshot()).critter.row, WATER_TOP);

  // Image: the far shore with its five bays.
  await startCrossing(api);
  await api.wait(150);
  await api.screenshot("scene");

  return check.verdict();
}
