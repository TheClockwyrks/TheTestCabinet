// Automated validation for the Controls item `menu-back`: Esc goes back from a sub-screen.
// From the title, How to Play is opened, then Esc must return to the title.

import { title, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.menu-back");

  await title(api);
  await api.call("press", "ArrowDown"); // highlight HOW TO PLAY
  await api.call("press", "Enter");
  check.expectEq("How to Play opens", (await api.snapshot()).screen, "howto");

  await api.call("press", "Escape");
  check.expectEq("Esc returns from How to Play to the title", (await api.snapshot()).screen, "title");

  await liveClip(api, 500);
  return check.verdict();
}
