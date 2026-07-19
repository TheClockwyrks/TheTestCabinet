// Automated validation for the Presentation sub-item `state-howto`: the how-to-play
// screen is reachable, and the debug API captures it. From the title, a real click
// (injected pointer input) on the HOW TO PLAY menu item opens the how-to screen; the
// screen is read back and captured. Whether it reads well is judged by eye.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-howto");

  await api.reset();
  // Click the second title-menu item (HOW TO PLAY), centered on the stage.
  await api.call("click", 640, 534);
  await api.wait(120);
  check.expectEq("clicking HOW TO PLAY opens the how-to screen", (await api.snapshot()).screen, "howto");
  await api.screenshot("howto");

  return check.verdict();
}
