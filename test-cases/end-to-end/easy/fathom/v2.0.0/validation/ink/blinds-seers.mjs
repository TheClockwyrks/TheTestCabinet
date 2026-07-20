// ink.blinds-seers: ink blinds the sight-based Lanternjaw and Flarefish (breaking their
// fix) but does nothing to the sound-based Gloamfin.
//
// The old script ran its three scenarios by restarting the dive between them, which `act`
// cannot do: `reset` takes the clock back mid-phase and would freeze the recording. Each
// scenario is re-posed with control ops instead — den the predator that is finished, put
// the next one on the sight line, re-light the forager — which is all the restart was
// doing here. The one thing the restart also cleared was the ink cloud itself, so the
// Flarefish scenario waits it out first (it is posed on the same sight line, and a
// lingering cloud would blind the Flarefish before it ever fixed, quietly turning the
// check into a tautology). The Gloamfin needs no such wait: it is put into `chase`
// outright and is deaf to ink by definition, which is the very thing being shown.
import {
  startPlaying,
  findSightLine,
  denAllExcept,
  pred,
} from "../_helpers.mjs";

export default function item() {
  // The forager/predator tiles, located once from the maze arrange read.
  let close;
  let apart;
  // The before/after states each scenario captured.
  let lBefore;
  let lAfter;
  let fBefore;
  let fAfter;
  let gBefore;
  let gAfter;

  return {
    id: "ink.blinds-seers",

    async arrange(api) {
      const snap = await startPlaying(api);
      close = findSightLine(snap, 2);
      apart = findSightLine(snap, 3);
      // Scenario 1: the Lanternjaw, fixed on the forager by its light.
      await denAllExcept(api, ["lanternjaw"]);
      await api.call("setForager", {
        tx: close.forager.tx,
        ty: close.forager.ty,
      });
      await api.call("setPredator", "lanternjaw", {
        tx: close.pred.tx,
        ty: close.pred.ty,
        mode: "wander",
      });
      await api.call("poseLastPlankton");
      await api.call("setBrightness", 1);
    },

    async act(api) {
      // --- the Lanternjaw ---
      await api.advance(6); // 6 ticks = the old 0.05 s
      lBefore = pred(await api.snapshot(), "lanternjaw").state;
      await api.call("clearCooldowns");
      await api.call("press", "ShiftLeft");
      await api.advance(24); // 24 ticks = the old 0.2 s
      lAfter = pred(await api.snapshot(), "lanternjaw").state;

      // --- the Flarefish, on the same sight line ---
      // Den the Lanternjaw first so nothing can catch the forager while the cloud burns
      // off, then let the ~3 s ink life expire before posing the next seer.
      await denAllExcept(api, ["flarefish"]);
      await api.advance(372); // 372 ticks = 3.1 s, just past the 3 s INK_LIFE
      await api.call("setForager", {
        tx: close.forager.tx,
        ty: close.forager.ty,
      });
      await api.call("setPredator", "flarefish", {
        tx: close.pred.tx,
        ty: close.pred.ty,
        mode: "wander",
      });
      await api.call("poseLastPlankton");
      await api.call("setBrightness", 1);
      await api.advance(6); // 6 ticks = the old 0.05 s
      fBefore = pred(await api.snapshot(), "flarefish").state;
      await api.call("clearCooldowns");
      await api.call("press", "ShiftLeft");
      await api.advance(24); // 24 ticks = the old 0.2 s
      fAfter = pred(await api.snapshot(), "flarefish").state;

      // --- the Gloamfin, chasing by sound, is unaffected ---
      await denAllExcept(api, ["gloamfin"]);
      await api.call("setForager", {
        tx: apart.forager.tx,
        ty: apart.forager.ty,
      });
      await api.call("setPredator", "gloamfin", {
        tx: apart.pred.tx,
        ty: apart.pred.ty,
        mode: "chase",
      });
      await api.call("poseLastPlankton");
      await api.advance(6); // 6 ticks = the old 0.05 s
      gBefore = pred(await api.snapshot(), "gloamfin").state;
      await api.call("clearCooldowns");
      await api.call("press", "ShiftLeft");
      await api.advance(24); // 24 ticks = the old 0.2 s
      gAfter = pred(await api.snapshot(), "gloamfin").state;

      await api.advance(84); // 84 ticks = the old 700 ms live tail
    },

    async assert(api, check) {
      check.expectEq("the Lanternjaw is fixed before ink", lBefore, "chase");
      check.expectEq(
        "ink blinds the Lanternjaw (fix broken)",
        lAfter,
        "wander",
      );

      check.expectEq("the Flarefish is fixed before ink", fBefore, "chase");
      check.expectEq("ink blinds the Flarefish (fix broken)", fAfter, "wander");

      check.expectEq("the Gloamfin is chasing", gBefore, "chase");
      check.expectEq(
        "ink does not affect the Gloamfin (still chasing)",
        gAfter,
        "chase",
      );
    },
  };
}
