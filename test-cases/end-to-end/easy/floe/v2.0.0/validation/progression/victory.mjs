// Automated validation for the Progression item `victory`.
//
// Clearing the eighth level wins the game (the victory screen appears). The level
// is set to 8 with four bays filled; a real hop fills the fifth, and the real
// flow reaches victory, which the snapshot reads back and a screenshot captures.
// See validation/_helpers.mjs.

import { WATER_TOP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("progression.victory");

  await api.reset();
  await api.call("setLevel", 8);
  await api.call("setBays", [true, true, true, true, false]);
  await api.call("setLane", WATER_TOP, { cols: [35], speed: 0 });
  await api.call("placeCritter", 35, WATER_TOP);

  await api.call("press", "ArrowUp"); // fill the fifth bay at level 8 -> victory
  await api.step(0.2);
  const s = await api.snapshot();
  check.expectEq("clearing level 8 wins the game", s.screen, "victory");

  await api.wait(150);
  await api.screenshot("victory");

  return check.verdict();
}
