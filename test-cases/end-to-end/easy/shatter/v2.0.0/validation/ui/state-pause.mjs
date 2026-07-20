// Automated validation for the UI item `state-pause`: the pause screen is reachable,
// captured for review. A real game is started and paused; the pause state is read back and
// the pause menu captured (offering resume, restart, and quit).

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-pause");

  await api.reset({ seed: 1 });
  await api.call("startGame");
  await api.call("press", "Escape");
  await api.wait(140);
  check.expectEq("pausing a live game reaches the pause screen", (await api.snapshot()).screen, "paused");

  await api.screenshot("pause");
  return check.verdict();
}
