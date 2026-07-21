// Automated validation for the UI item `state-howto`: the how-to-play screen is
// reachable from the menu, and the debug API captures it. From the title the menu
// is moved down to HOW TO PLAY with injected keys and confirmed; the screen is read
// back and captured. The layout is judged by eye from the capture.

export default function item() {
  // The screen after the menu selection.
  let screen;

  return {
    id: "ui.state-howto",

    // Back to the title, where the menu starts on CROSS.
    async arrange(api) {
      await api.reset();
    },

    // The menu navigation itself — the reviewer sees the selection move and the
    // how-to screen open, which is what the capture is proof of.
    async act(api) {
      await api.call("press", "ArrowDown"); // CROSS -> HOW TO PLAY
      await api.call("press", "Enter"); // open How to Play
      // 0.12 s is 14.4 ticks, which the tick contract rejects rather than rounds. This
      // is a settle for the screen transition, so it rounds UP to 15 — never shorter.
      await api.advance(15);
      screen = (await api.snapshot()).screen;
      await api.screenshot("howto");
    },

    async assert(api, check) {
      check.expectEq(
        "selecting How to Play opens the how-to screen",
        screen,
        "howto",
      );
    },
  };
}
