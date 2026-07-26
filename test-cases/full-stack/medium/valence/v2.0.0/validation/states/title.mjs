// Automated validation for the States sub-item `title`: the title / main menu is
// reachable, and the debug API captures it so a reviewer sees the actual screen.

export default function item() {
  let screen;

  return {
    id: "states.title",

    async arrange(api) {
      await api.reset();
    },

    // Nothing moves here — the screen itself is the evidence — so `act` is the repaint
    // pause the capture needs. `settle` is a REAL pause in both passes, which is what
    // guarantees the title has actually been drawn before it is read.
    async act(api) {
      await api.settle(150);
      screen = (await api.snapshot()).screen;
      await api.screenshot("title");
    },

    async assert(api, check) {
      check.expectEq(
        "the title / main menu is the initial screen",
        screen,
        "title",
      );
    },
  };
}
