// alert.flarefish: a Flarefish acquisition (here via light-sense) fires the alert.
//
// Posing the pair is pure control ops, so it is `arrange`; the acquisition itself takes
// real simulation time to happen, so the watch for the alert is `act` — and that watch
// is exactly what the recorded clip shows.
import {
  startPlaying,
  findSightLine,
  denAllExcept,
  pred,
} from "../_helpers.mjs";

export default function item() {
  let r;

  return {
    id: "alert.flarefish",

    async arrange(api) {
      const snap = await startPlaying(api);
      const line = findSightLine(snap, 3);
      await denAllExcept(api, ["flarefish"]);
      await api.call("setForager", {
        tx: line.forager.tx,
        ty: line.forager.ty,
      });
      await api.call("setPredator", "flarefish", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "wander",
      });
      await api.call("poseLastPlankton");
      await api.call("setBrightness", 1);
    },

    async act(api) {
      // 72 ticks = the old 0.6 s cap; poll 6 = the old 0.05 s sweep chunk.
      r = await api.until((s) => pred(s, "flarefish").alert === true, {
        max: 72,
        poll: 6,
      });
      // 84 ticks = the old 700 ms live tail, now inside `act` so what it shows runs at
      // the game's own speed. The verdict was captured above, so this cannot affect it.
      await api.advance(84);
    },

    async assert(api, check) {
      check.expectOk("the Flarefish fires the detection alert on a fix", r.hit);
    },
  };
}
