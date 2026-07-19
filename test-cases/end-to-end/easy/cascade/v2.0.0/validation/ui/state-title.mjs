// Automated validation for the Presentation sub-item `state-title`: the title / main
// menu is reachable, and the debug API captures it so a reviewer sees the actual
// menu. A reset returns the game to its initial title state; the screen is read back
// and captured. Whether the menu reads and lays out well is judged by eye from the
// capture.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-title");

  await api.reset();
  await api.wait(120);
  check.expectEq("the title / main menu is the initial screen", (await api.snapshot()).screen, "title");
  await api.screenshot("title");

  return check.verdict();
}
