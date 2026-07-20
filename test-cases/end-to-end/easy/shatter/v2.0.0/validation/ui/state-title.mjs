// Automated validation for the UI item `state-title`: the title / main menu is reachable,
// captured so a reviewer sees the actual menu. A reset returns the game to its initial
// title state; the screen is read back and a screenshot captured. Whether the menu is laid
// out well is judged by eye from the capture.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-title");

  await api.reset({ seed: 1 });
  await api.wait(140);
  check.expectEq("the title / main menu is the initial screen", (await api.snapshot()).screen, "title");

  await api.screenshot("title");
  return check.verdict();
}
