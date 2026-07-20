// Automated validation for ui.state-howto: the how-to-play screen is reachable, and
// the debug API navigates to it (from the title, select How to Play and confirm) and
// captures it. The layout is judged by eye from the capture.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-howto");

  await api.reset({ seed: 1 });
  await api.call("press", "ArrowDown"); // DESCEND -> HOW TO PLAY
  await api.call("press", "Enter"); // confirm
  await api.wait(150);
  check.expectEq("the how-to-play screen is reachable", (await api.snapshot()).screen, "howto");
  await api.screenshot("howto");

  return check.verdict();
}
