// controls.mute: M toggles the mute flag (captured at the title).
export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.mute");
  await api.reset();
  const before = (await api.snapshot()).muted;
  await api.call("press", "KeyM");
  const after = (await api.snapshot()).muted;
  check.expectEq("mute starts off at the title", before, false);
  check.expectEq("pressing M toggles mute on", after, true);
  await api.wait(150);
  await api.screenshot("mute");
  return check.verdict();
}
