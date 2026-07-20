// Automated validation for the UI sub-item `state-title`: the title / main menu is
// reachable, and the debug API captures it so a reviewer sees the actual menu.
//
// A reset returns the game to its initial title state; the screen is read back and a
// screenshot captured as the reviewer's proof (paired against the reference build's
// own title). Whether the menu is laid out well is judged by eye from the capture.
//
// The reset is instant, so it is `arrange`. The output is a still, but `act` still has
// to be the meaningful part: it holds long enough for the title to paint and then
// takes the capture (which only produces media in the record pass), so the still shows
// a drawn menu rather than a blank first frame.

// The old script waited 120ms for the title to redraw. At 120 Hz that is 14.4 ticks,
// which the tick contract rejects rather than rounds, so round UP to the next whole
// tick: a paint settle only has to be at least as long as it was, and one extra tick
// (~8ms) cannot change what the title shows.
const SETTLE_TICKS = 15;

export default function item() {
  // The screen `act` read once the title had painted, checked by `assert`.
  let screen;

  return {
    id: "ui.state-title",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      await api.advance(SETTLE_TICKS);
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
