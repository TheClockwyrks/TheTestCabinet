// State: the title / main menu is the initial screen. Captured so a reviewer sees the menu.

export default function item() {
  // The screen the build opens on.
  let screen;

  return {
    id: "states.title",

    // Land on the title. `reset` is arrange-only.
    async arrange(api) {
      await api.reset();
    },

    // There is nothing to drive here — the item is about the state the build OPENS in —
    // so `act` is the paint settle that lets the menu draw, plus the capture itself.
    async act(api) {
      await api.settle(150);
      screen = (await api.snapshot()).screen;
      await api.screenshot("state");
    },

    async assert(api, check) {
      check.expectEq("the title menu is the initial screen", screen, "title");
    },
  };
}
