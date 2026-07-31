// flarefish.light-sense: drifting into your glow (within R, line of sight) fixes it on
// you, exactly like the Lanternjaw — no flare needed.
//
// The lit sight line is posed instantly (`arrange`); the fix it produces takes the real
// sim, so it is `act` and is what the clip shows.
import {
  denAllExcept,
  findSightLine,
  pred,
  quietBoard,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let p;

  return {
    id: "flarefish.light-sense",

    async arrange(api) {
      const snap = await startPlaying(api);
      const line = findSightLine(snap, 3);
      await denAllExcept(api, ["flarefish"]);
      await api.call("setPredator", "flarefish", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "wander",
      });
      await quietBoard(api, line.forager);
      await api.call("setBrightness", 1); // R = 320 px, well within the 96 px gap
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      p = pred(await api.snapshot(), "flarefish");
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectEq(
        "the Flarefish fixes on your light without flaring",
        p.state,
        "chase",
      );
      check.expectOk(
        "its detection alert fires on the light-sense fix",
        p.alert === true,
      );
    },
  };
}
