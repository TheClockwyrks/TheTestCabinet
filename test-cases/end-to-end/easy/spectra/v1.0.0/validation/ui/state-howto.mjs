// Automated validation for the UI sub-item `state-howto`: the how-to-play screen is
// reachable, and captured for the reviewer.
//
// From the title, the menu is navigated to HOW TO PLAY (the second entry) with
// injected keys and confirmed; the resulting screen is read back and captured.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-howto");

  await api.reset();
  await api.call("press", "ArrowDown"); // move to HOW TO PLAY
  await api.call("press", "Enter"); // confirm
  await api.wait(120);
  check.expectEq("the how-to-play screen is reachable", (await api.snapshot()).screen, "howto");
  await api.screenshot("howto");

  return check.verdict();
}
