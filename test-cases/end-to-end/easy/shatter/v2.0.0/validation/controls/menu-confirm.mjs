// Automated validation for the Controls item `menu-confirm`: Enter (or Space) confirms the
// highlighted menu selection. From the title with PLAY highlighted, Enter starts the game;
// a fresh title then confirms with Space too.

import { title, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.menu-confirm");

  await title(api);
  await api.call("press", "Enter"); // confirm PLAY
  check.expectEq("Enter confirms the selection and starts the game", (await api.snapshot()).screen, "playing");

  await title(api);
  await api.call("press", "Space"); // Space also confirms
  check.expectEq("Space also confirms the selection", (await api.snapshot()).screen, "playing");

  await liveClip(api, 600);
  return check.verdict();
}
