// Automated validation for the Presentation sub-item `state-howto`: the how-to-play
// screen is reachable, and the debug API captures it. From the title, the how-to
// menu item is selected and activated through the debug API's `selectMenu`, which
// opens the how-to screen the same way clicking the item does; the screen is read
// back and captured. Whether it reads well is left to the reviewer.
//
// `selectMenu(1)` (the `HOW TO PLAY` item — `specs/states.md` fixes the menu order,
// NEW GAME then HOW TO PLAY) is used deliberately in place of a fixed pointer click.
// The title-menu layout is the build's own design (menus and screens are reviewed by
// a person, not scored against a baseline), so a hard-coded click coordinate would
// reach only a build that happens to place the item there and would falsely fail a
// perfectly reachable how-to screen laid out differently. `selectMenu` reaches it by
// index through the real activation path regardless of where the item is drawn.
//
// The reset to the title is the precondition (`arrange`); activating the how-to menu
// item is the behavior under test, so it is what `act` films. The pause before the
// capture is `api.settle`, not `api.advance`: a screenshot must read a PAINTED frame,
// and stepping the simulation produces none. `settle` is real milliseconds in both
// passes, so the 120 ms carries over unconverted.

export default function item() {
  // The screen after the how-to item was activated.
  let screen;

  return {
    id: "ui.state-howto",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      // Activate the HOW TO PLAY title-menu item (index 1) through the real menu
      // activation path, independent of where the build draws it.
      await api.call("selectMenu", 1);
      await api.settle(120);
      screen = (await api.snapshot()).screen;
      await api.screenshot("howto");
    },

    async assert(api, check) {
      check.expectEq(
        "activating HOW TO PLAY opens the how-to screen",
        screen,
        "howto",
      );
    },
  };
}
