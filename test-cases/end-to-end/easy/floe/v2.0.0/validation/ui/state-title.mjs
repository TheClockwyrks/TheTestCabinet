// Automated validation for the UI item `state-title`: the title / main menu is
// reachable, and the debug API captures it so a reviewer sees the actual screen.
// The auto-verdict confirms the state is reachable; the layout is judged by eye.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-title");

  await api.reset();
  await api.wait(120);
  check.expectEq("reset returns to the title screen", (await api.snapshot()).screen, "title");
  await api.screenshot("title");

  return check.verdict();
}
