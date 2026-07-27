// gloamfin.fix-and-alert: hearing the forager at close range hands it a fix — it fires
// the alert and chases.
//
// The close pair is posed instantly (`arrange`); the hearing that turns a wander into a
// chase takes the real sim, so it is `act` and is what the clip shows.
import {
  denAllExcept,
  findSightLine,
  pred,
  quietBoard,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let startState;
  let r;

  return {
    id: "gloamfin.fix-and-alert",

    async arrange(api) {
      const snap = await startPlaying(api);
      const line = findSightLine(snap, 2); // 64 px — inside close hearing
      await denAllExcept(api, ["gloamfin"]);
      await api.call("setPredator", "gloamfin", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "wander",
      });
      await quietBoard(api, line.forager);
    },

    async act(api) {
      startState = pred(await api.snapshot(), "gloamfin").state;
      // 60 ticks = the old 0.5 s cap; poll 6 = the old 0.05 s sweep chunk.
      r = await api.until((s) => pred(s, "gloamfin").state === "chase", {
        max: 60,
        poll: 6,
      });
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectEq("the Gloamfin starts wandering", startState, "wander");
      check.expectOk("close hearing hands it a fix (it chases)", r.hit);
      check.expectOk(
        "the detection alert fires on the fix",
        pred(r.snap, "gloamfin").alert === true,
      );
    },
  };
}
