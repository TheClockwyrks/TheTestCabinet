// gloamfin.chase-cap: on a straight run it chases at its ~134 px/s cap.
//
// The straight corridor is posed instantly (`arrange`); the run down it — where the speed
// settles at the cap — is the real sim, so it is `act` and is what the clip shows.
import {
  GLOAMFIN_CHASE,
  denAllExcept,
  findSightLine,
  pred,
  quietBoard,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let p;

  return {
    id: "gloamfin.chase-cap",

    async arrange(api) {
      const snap = await startPlaying(api);
      const line = findSightLine(snap, 4); // straight corridor, 4 tiles apart
      await denAllExcept(api, ["gloamfin"]);
      // The forager first: `chase` fixes on wherever it is standing when the mode is
      // set, so it has to be parked on the far end of the straight run by then.
      await quietBoard(api, line.forager);
      await api.call("setPredator", "gloamfin", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "chase",
      });
    },

    async act(api) {
      await api.advance(36); // 36 ticks = the old 0.3 s: chasing straight, no corner — speed at the cap
      p = pred(await api.snapshot(), "gloamfin");
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectEq("the Gloamfin is chasing", p.state, "chase");
      check.expectClose(
        "it chases at its ~134 px/s cap on a straight run",
        p.speed,
        GLOAMFIN_CHASE,
        6,
      );
    },
  };
}
