// Automated validation for the Audio sub-item `mute-toggle`.
//
// The mute key (M) toggles mute. From the title (mute off) a single M press flips
// the muted flag on, read back from snapshot(); a title screenshot captures the
// changed mute state for the reviewer.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("audio.mute-toggle");

  await api.reset();
  check.expectOk("mute starts off", (await api.snapshot()).muted === false);
  await api.call("press", "KeyM");
  check.expectOk("pressing M toggles mute on", (await api.snapshot()).muted === true);
  await api.wait(120);
  await api.screenshot("mute");

  return check.verdict();
}
