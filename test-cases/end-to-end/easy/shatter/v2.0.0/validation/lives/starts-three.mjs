// Automated validation for the Lives item `starts-three`: a new game starts with 3 ships.
// A real game is started (through the same path PLAY takes) and the life count read back;
// the fresh HUD is captured.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("lives.starts-three");

  await api.reset({ seed: 1 });
  await api.call("startGame");
  const snap = await api.snapshot();

  check.expectEq("a new game starts with 3 ships", snap.lives, 3);
  check.expectEq("the new game is in play", snap.screen, "playing");

  await api.wait(140);
  await api.screenshot("lives");
  return check.verdict();
}
