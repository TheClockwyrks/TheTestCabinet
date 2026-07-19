// Automated validation for the Controls sub-item `arm-hotkeys`.
//
// The number keys 1..8 arm the shop towers in shop order (specs/controls.md). We
// inject the keys and read the held-preview type back — Digit1 arms the first shop
// tower (Arc), Digit4 the fourth (Bloom), Digit7 the seventh (Forge).

import { newGame, press, TOWER_ORDER } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.arm-hotkeys");

  await newGame(api, "containment", "medium", 100000);
  await press(api, "Digit1");
  check.expectEq("Digit1 arms the first shop tower", (await api.snapshot()).build.type, TOWER_ORDER[0]);
  await press(api, "Digit4");
  check.expectEq("Digit4 arms the fourth shop tower", (await api.snapshot()).build.type, TOWER_ORDER[3]);
  await press(api, "Digit7");
  check.expectEq("Digit7 arms the seventh shop tower", (await api.snapshot()).build.type, TOWER_ORDER[6]);

  await api.call("setAutoStep", true);
  await api.wait(1400);
  return check.verdict();
}
