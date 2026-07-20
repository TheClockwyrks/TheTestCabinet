// Automated validation for the States sub-item `title`.
//
// The title / main menu is the initial screen (specs/states.md). A reset returns the
// game to it; we read the screen back and capture it for the reviewer.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.title");
  await api.reset();
  await api.wait(120);
  check.expectEq("the title menu is the initial screen", (await api.snapshot()).screen, "title");
  await api.screenshot("title");
  return check.verdict();
}
