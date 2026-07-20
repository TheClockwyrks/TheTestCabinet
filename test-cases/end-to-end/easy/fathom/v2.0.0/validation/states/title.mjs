// states.title: the title / main menu is the initial screen.
//
// The reset is instant (`arrange`); `act` only holds still long enough for the title to
// be painted and captured.

export default function item() {
  let screen;

  return {
    id: "states.title",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      await api.settle(150); // a REAL pause (the old wait(150)) so the title is painted
      screen = (await api.snapshot()).screen;
      await api.screenshot("title");
    },

    async assert(api, check) {
      check.expectEq("the title is the initial screen", screen, "title");
    },
  };
}
