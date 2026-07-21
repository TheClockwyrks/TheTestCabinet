// Automated validation for ui.state-howto: the how-to-play screen is reachable, and
// the debug API navigates to it (from the title, select How to Play and confirm) and
// captures it. The layout is judged by eye from the capture.

export default function item() {
  let screen;

  return {
    id: "ui.state-howto",

    async arrange(api) {
      await api.reset({ seed: 1 });
    },

    // The menu navigation lives here rather than in `arrange` so the recording shows
    // the selection moving and the screen changing; `press` is a control op, so it
    // consumes no simulation time and the verdict is the same either way.
    async act(api) {
      await api.call("press", "ArrowDown"); // DESCEND -> HOW TO PLAY
      await api.call("press", "Enter"); // confirm
      await api.settle(150); // a real pause so the how-to screen has painted
      screen = (await api.snapshot()).screen;
      await api.screenshot("howto");
    },

    async assert(api, check) {
      check.expectEq("the how-to-play screen is reachable", screen, "howto");
    },
  };
}
