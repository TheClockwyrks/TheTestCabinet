// Automated validation for the Controls item `menu-move`: Up/Down (or W/S) move the title
// menu selection. From the title, Down advances the highlighted entry, Up returns it, and
// S also advances it — each read back from the menu index.

import { title, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.menu-move");

  await title(api);
  check.expectEq("the title opens on the first entry", (await api.snapshot()).menuIndex, 0);

  await api.call("press", "ArrowDown");
  check.expectEq("Down moves the selection to the next entry", (await api.snapshot()).menuIndex, 1);

  await api.call("press", "ArrowUp");
  check.expectEq("Up moves the selection back", (await api.snapshot()).menuIndex, 0);

  await api.call("press", "KeyS");
  check.expectEq("S also moves the selection down", (await api.snapshot()).menuIndex, 1);

  await liveClip(api, 500);
  return check.verdict();
}
