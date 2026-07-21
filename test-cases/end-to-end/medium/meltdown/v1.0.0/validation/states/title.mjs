// Automated validation for the States sub-item `title`.
//
// The title / main menu is the initial screen (specs/states.md). A reset returns the
// game to it; we read the screen back and capture it for the reviewer.

export default function item() {
  let screen;

  return {
    id: "states.title",

    async arrange(api) {
      await api.reset();
    },

    // Let the title screen paint a frame before reading and capturing it.
    async act(api) {
      await api.settle(120);
      screen = (await api.snapshot()).screen;
      await api.screenshot("title");
    },

    async assert(api, check) {
      check.expectEq("the title menu is the initial screen", screen, "title");
    },
  };
}
