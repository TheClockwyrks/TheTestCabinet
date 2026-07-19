// Automated validation for the Waves item `banner`: a brief WAVE N banner shows at the
// start of each wave. A real game is started and the field cleared; stepping a moment
// raises the next wave's banner, which the snapshot reports and a screenshot captures.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("waves.banner");

  await api.reset({ seed: 3 });
  await api.call("startGame");
  await api.call("setInvuln", 99);
  await api.call("clearRocks");
  await api.step(0.1); // the cleared field advances the wave and raises its banner

  const snap = await api.snapshot();
  check.expectOk("the WAVE banner is showing at the start of the new wave", snap.waveBanner === true);
  check.expectEq("the banner is for the new wave (wave 2)", snap.wave, 2);

  await api.wait(140); // let a frame paint the banner
  await api.screenshot("banner");
  return check.verdict();
}
