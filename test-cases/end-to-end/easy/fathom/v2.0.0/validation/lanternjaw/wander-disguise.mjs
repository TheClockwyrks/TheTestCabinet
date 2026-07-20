// lanternjaw.wander-disguise: undetected it drifts at the drifter's ~64 px/s (reading
// disguised); on a fix it drops the disguise and hunts at ~116 px/s.
//
// The undetected Lanternjaw is posed instantly (`arrange`); both speed readings need the
// sim to have run, and the switch into `chase` between them is a control op, so the whole
// drift-then-hunt sequence is `act` — and that is what the clip shows.
import {
  startPlaying,
  findSonarTarget,
  denAllExcept,
  pred,
  DRIFTER_SPEED,
  PREDATOR_SPEED,
} from "../_helpers.mjs";

export default function item() {
  let target;
  let w;
  let h;

  return {
    id: "lanternjaw.wander-disguise",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, ["lanternjaw"]);
      target = findSonarTarget(snap, snap.forager); // beyond the light, so it stays undetected
      await api.call("setPredator", "lanternjaw", {
        tx: target.tx,
        ty: target.ty,
        mode: "wander",
      });
      await api.call("poseLastPlankton");
    },

    async act(api) {
      await api.advance(24); // 24 ticks = the old 0.2 s
      w = pred(await api.snapshot(), "lanternjaw");

      await api.call("setPredator", "lanternjaw", {
        tx: target.tx,
        ty: target.ty,
        mode: "chase",
      });
      await api.advance(6); // 6 ticks = the old 0.05 s
      h = pred(await api.snapshot(), "lanternjaw");

      await api.advance(108); // 108 ticks = the old 900 ms live tail
    },

    async assert(api, check) {
      check.expectOk("undetected it reads as disguised", w.disguised === true);
      check.expectClose(
        "it drifts at the drifter's ~64 px/s",
        w.speed,
        DRIFTER_SPEED,
        6,
      );
      check.expectOk("on a fix it drops the disguise", h.disguised === false);
      check.expectClose("and hunts at ~116 px/s", h.speed, PREDATOR_SPEED, 10);
    },
  };
}
