// Automated validation for the Bays item `clear-level`.
//
// Filling the last of the five bays clears the level: the level advances and the
// bays reset. Four bays are pre-filled and the fifth is filled by a real hop; the
// real level logic then advances the level, which the snapshot reads back after the
// between-levels pause. See validation/_helpers.mjs.

import { startCrossing, stepUntil, WATER_TOP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("bays.clear-level");

  await startCrossing(api);
  await api.call("setBays", [true, true, true, true, false]);
  await api.call("setLane", WATER_TOP, { cols: [35], speed: 0 }); // floe below bay 4
  await api.call("placeCritter", 35, WATER_TOP);
  check.expectEq("starting at level 1", (await api.snapshot()).level, 1);

  await api.call("press", "ArrowUp"); // fill the fifth bay -> clear the level
  await api.step(0.15);
  const r = await stepUntil(api, (s) => s.level === 2, 2.5, 0.1);
  check.expectOk("filling all five bays advances the level", r.hit);
  check.expectEq("the level is now 2", r.snap.level, 2);
  check.expectOk("the bays reset for the new level", r.snap.bays.every((b) => b === false));

  // Clip: filling the last bay and the level-clear banner in real time.
  await startCrossing(api);
  await api.call("setBays", [true, true, true, true, false]);
  await api.call("setLane", WATER_TOP, { cols: [35], speed: 0 });
  await api.call("placeCritter", 35, WATER_TOP);
  await api.wait(250);
  await api.call("press", "ArrowUp");
  await api.wait(1800);

  return check.verdict();
}
