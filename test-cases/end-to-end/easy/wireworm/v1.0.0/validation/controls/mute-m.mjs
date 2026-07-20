// Automated validation for controls.mute-m: pressing M toggles the game's mute state.
// Injected input flows through the real key handling (audio.toggleMute), and the
// muted flag flips.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.mute-m");

  await api.reset({ seed: 1 });
  const before = (await api.snapshot()).muted;
  await api.call("press", "KeyM");
  const after = (await api.snapshot()).muted;

  check.expectEq("mute starts off", before, false);
  check.expectEq("pressing M toggles mute on", after, true);

  await api.wait(150);
  await api.screenshot("mute");

  return check.verdict();
}
