// Automated validation for the Controls item `mute`.
//
// Pressing M toggles mute. From the title (mute off) a single injected M press
// flips `muted` on, and a title screenshot captures the changed state. See
// validation/_helpers.mjs.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.mute");

  await api.reset();
  check.expectEq("mute starts off", (await api.snapshot()).muted, false);
  await api.call("press", "KeyM");
  check.expectEq("pressing M toggles mute on", (await api.snapshot()).muted, true);

  await api.wait(200); // let the title redraw with the mute state
  await api.screenshot("title");

  return check.verdict();
}
