// states.howto: the how-to-play screen is reachable from the menu.
//
// The reset to the title is instant (`arrange`); the menu navigation and the settle the
// capture needs are `act`, so the clip shows the screen actually being reached.

export default function item() {
  let screen;

  return {
    id: "states.howto",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      await api.call("press", "ArrowDown"); // move from DIVE to HOW TO PLAY
      await api.call("press", "Enter"); // confirm
      await api.settle(150); // a REAL pause (the old wait(150)) so the screen is painted
      screen = (await api.snapshot()).screen;
      await api.screenshot("howto");
    },

    async assert(api, check) {
      check.expectEq("the how-to-play screen is reached", screen, "howto");
    },
  };
}
