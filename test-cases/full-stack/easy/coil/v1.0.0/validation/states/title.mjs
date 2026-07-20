// Automated validation for the Game States sub-item `title`.
//
// The title / main menu is the initial screen. A reset returns the game to it; the
// screen is read back and captured so a reviewer sees the actual menu (paired against
// the reference build's own title). How the menu lays out is judged by eye.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.title");

  await api.reset();
  await api.wait(120);
  check.expectEq("the title is the initial screen", (await api.snapshot()).screen, "title");
  await api.screenshot("title");

  return check.verdict();
}
