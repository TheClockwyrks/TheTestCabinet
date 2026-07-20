// Automated validation for the States sub-item `mapselect`: the map-select screen is
// reachable (via the campaign start), and the debug API captures it.

export default function item() {
  let screen;

  return {
    id: "states.mapselect",

    async arrange(api) {
      await api.reset();
    },

    // Reaching the screen is the behavior, so the navigation belongs here. `settle` is a
    // real repaint pause in both passes, so the still shows the screen actually drawn.
    async act(api) {
      await api.call("goToMapSelect");
      await api.settle(150);
      screen = (await api.snapshot()).screen;
      await api.screenshot("mapselect");
    },

    async assert(api, check) {
      check.expectEq("map select is reachable", screen, "mapselect");
    },
  };
}
