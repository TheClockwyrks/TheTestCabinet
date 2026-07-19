// Automated validation for the States sub-item `title`: the title / main menu is
// reachable, and the debug API captures it so a reviewer sees the actual screen.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.title");

  await api.reset();
  await api.wait(150);
  check.expectEq("the title / main menu is the initial screen", (await api.snapshot()).screen, "title");
  await api.screenshot("title");

  return check.verdict();
}
