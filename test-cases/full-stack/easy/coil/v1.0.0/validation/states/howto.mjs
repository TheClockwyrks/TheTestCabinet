// Automated validation for the Game States sub-item `howto`.
//
// The how-to-play screen is reachable from the title menu. From the title, the menu is
// navigated down to HOW TO PLAY with injected keys and confirmed; the screen is read
// back and captured. How the screen reads is judged by eye from the capture.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.howto");

  await api.reset();
  await api.call("press", "ArrowDown"); // play entry -> HOW TO PLAY
  await api.call("press", "Enter"); // open How to Play
  await api.wait(120);
  check.expectEq(
    "selecting How to Play opens the how-to screen",
    (await api.snapshot()).screen,
    "howto",
  );
  await api.screenshot("howto");

  return check.verdict();
}
