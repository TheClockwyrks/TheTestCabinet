// states.howto: the how-to-play screen is reachable from the menu.
export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.howto");
  await api.reset();
  await api.call("press", "ArrowDown"); // move from DIVE to HOW TO PLAY
  await api.call("press", "Enter"); // confirm
  await api.wait(150);
  check.expectEq("the how-to-play screen is reached", (await api.snapshot()).screen, "howto");
  await api.screenshot("howto");
  return check.verdict();
}
