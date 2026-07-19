// Automated validation for the Controls sub-item `mute-key`.
//
// Pressing M toggles the mute state. From the title (mute off), a single M press flips
// the snapshot's `muted` flag on; the key flows through the real key handling. The
// title is captured so the reviewer sees the changed mute hint.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.mute-key");

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
