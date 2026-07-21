// states.countdown: starting a dive opens on the pre-start dive countdown.
//
// The reset to the title is instant (`arrange`); starting the dive and letting the
// countdown screen draw is `act`, so the clip and the still both show the dive opening.

export default function item() {
  let screen;

  return {
    id: "states.countdown",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      await api.call("startDive");
      await api.settle(150); // a REAL pause (the old wait(150)) so the countdown is painted
      screen = (await api.snapshot()).screen;
      await api.screenshot("countdown");
    },

    async assert(api, check) {
      check.expectEq(
        "starting a dive opens on the countdown",
        screen,
        "countdown",
      );
    },
  };
}
