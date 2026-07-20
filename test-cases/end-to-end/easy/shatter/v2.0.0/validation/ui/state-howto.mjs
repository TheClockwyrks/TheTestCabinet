// Automated validation for the UI item `state-howto`: the how-to-play screen is reachable,
// captured for review. From the title, the menu is navigated to How to Play and confirmed;
// the screen is read back and captured.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-howto");

  await api.reset({ seed: 1 });
  await api.call("press", "ArrowDown"); // highlight HOW TO PLAY
  await api.call("press", "Enter");
  await api.wait(140);
  check.expectEq("How to Play is reachable from the title", (await api.snapshot()).screen, "howto");

  await api.screenshot("howto");
  return check.verdict();
}
