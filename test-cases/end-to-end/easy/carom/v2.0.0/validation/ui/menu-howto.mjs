// Automated validation for the UI sub-item `state-howto`: the how-to-play screen is
// reachable, and the debug API captures it so a reviewer sees the actual screen.
//
// From the title, the menu is navigated down to HOW TO PLAY with injected keys and
// confirmed; the screen is read back and a screenshot captured as the reviewer's
// proof. Whether the screen reads well is judged by eye from the capture.
//
// The menu navigation is nothing but single key presses, which are instant, so all of
// it is `arrange`. The output is a still, but `act` still has to be the meaningful
// part: it holds long enough for the how-to screen to paint and then takes the capture
// (which only produces media in the record pass).

// The old script waited 120ms for the screen to draw. At 120 Hz that is 14.4 ticks,
// which the tick contract rejects rather than rounds, so round UP to the next whole
// tick: a paint settle only has to be at least as long as it was.
const SETTLE_TICKS = 15;

export default function item() {
  // The screen `act` read once How to Play had painted, checked by `assert`.
  let screen;

  return {
    id: "ui.state-howto",

    async arrange(api) {
      await api.reset();
      await api.call("press", "ArrowDown"); // SOLO -> VERSUS
      await api.call("press", "ArrowDown"); // VERSUS -> HOW TO PLAY
      await api.call("press", "Enter"); // open How to Play
    },

    async act(api) {
      await api.advance(SETTLE_TICKS);
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
