// Automated validation for ui.state-title: the title / main menu is reachable, and
// the debug API captures it so a reviewer sees the actual menu. Whether it is laid
// out well is judged by eye from the capture.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-title");

  await api.reset({ seed: 1 });
  await api.wait(150);
  check.expectEq("the title / main menu is the initial screen", (await api.snapshot()).screen, "title");
  await api.screenshot("title");

  return check.verdict();
}
