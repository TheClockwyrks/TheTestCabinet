// gloamfin.wander-speed: it wanders at ~116 px/s with no wind-up over time.
//
// The lone wanderer is posed instantly (`arrange`); the two readings a second apart —
// which is what "no wind-up over time" means — are the real sim, so they are `act`.
import {
  PREDATOR_SPEED,
  denAllExcept,
  findFarTile,
  pred,
  quietBoard,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let a;
  let b;

  return {
    id: "gloamfin.wander-speed",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, ["gloamfin"]);
      const far = findFarTile(snap, snap.forager, 8); // far, so it just wanders
      await api.call("setPredator", "gloamfin", {
        tx: far.tx,
        ty: far.ty,
        mode: "wander",
      });
      await quietBoard(api);
    },

    async act(api) {
      await api.advance(24); // 24 ticks = the old 0.2 s
      a = pred(await api.snapshot(), "gloamfin").speed;
      await api.advance(120); // 120 ticks = the old 1.0 s
      b = pred(await api.snapshot(), "gloamfin").speed;
      await api.advance(108); // 108 ticks = the old 900 ms live tail
    },

    async assert(api, check) {
      check.expectClose("wanders at ~116 px/s", a, PREDATOR_SPEED, 8);
      check.expectClose(
        "no speed wind-up over time (still ~116 px/s)",
        b,
        PREDATOR_SPEED,
        8,
      );
    },
  };
}
