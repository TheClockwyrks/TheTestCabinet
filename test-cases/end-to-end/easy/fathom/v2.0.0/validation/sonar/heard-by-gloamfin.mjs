// sonar.heard-by-gloamfin: a pulse reaching a wandering Gloamfin hands it a fix — it
// fires the alert and turns to chase.
//
// The Gloamfin is posed beyond hearing but inside the flood in `arrange`; firing the
// pulse and watching the front reach it is the real sim, so it is `act` — the clip is the
// ping travelling out and the Gloamfin turning.
import {
  denAllExcept,
  findSonarSenseTiles,
  pred,
  quietBoard,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let beforePulse;
  let r;

  return {
    id: "sonar.heard-by-gloamfin",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, ["gloamfin"]);
      const [target] = findSonarSenseTiles(snap, snap.forager, 1); // beyond hearing, inside the flood
      await api.call("setPredator", "gloamfin", {
        tx: target.tx,
        ty: target.ty,
        mode: "wander",
      });
      await quietBoard(api);
    },

    async act(api) {
      // 2 ticks for the old step(0.02) = 2.4 ticks: a "one moment later" beat so the
      // posed wander is live, not a measured duration.
      await api.advance(2);
      beforePulse = pred(await api.snapshot(), "gloamfin").state;
      await api.call("clearCooldowns");
      await api.call("press", "Space");
      // 180 ticks = the old 1.5 s cap; poll 6 = the old 0.05 s sweep chunk.
      r = await api.until((s) => pred(s, "gloamfin").state === "chase", {
        max: 180,
        poll: 6,
      });
      await api.advance(108); // 108 ticks = the old 900 ms live tail
    },

    async assert(api, check) {
      check.expectEq(
        "the Gloamfin is wandering before the pulse",
        beforePulse,
        "wander",
      );
      check.expectOk(
        "the pulse hands the wandering Gloamfin a fix (it chases)",
        r.hit,
      );
      check.expectOk(
        "the detection alert fires on the heard pulse",
        pred(r.snap, "gloamfin").alert === true,
      );
    },
  };
}
