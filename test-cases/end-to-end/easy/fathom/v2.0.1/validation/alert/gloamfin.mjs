// alert.gloamfin: a Gloamfin acquisition fires the detection alert.
//
// The pair is posed instantly in `arrange`; the acquisition needs the real sim to run,
// so the watch for the alert is `act` and is what the clip depicts.
import {
  denAllExcept,
  findSightLine,
  pred,
  quietBoard,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let r;

  return {
    id: "alert.gloamfin",

    async arrange(api) {
      const snap = await startPlaying(api);
      const line = findSightLine(snap, 2); // inside close hearing
      await denAllExcept(api, ["gloamfin"]);
      await api.call("setPredator", "gloamfin", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "wander",
      });
      await quietBoard(api, line.forager);
    },

    async act(api) {
      // 72 ticks = the old 0.6 s cap; poll 6 = the old 0.05 s sweep chunk.
      r = await api.until((s) => pred(s, "gloamfin").alert === true, {
        max: 72,
        poll: 6,
      });
      await api.advance(84); // 84 ticks = the old 700 ms live tail
    },

    async assert(api, check) {
      check.expectOk("the Gloamfin fires the detection alert on a fix", r.hit);
    },
  };
}
