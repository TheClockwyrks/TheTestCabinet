// flarefish.ink-breaks: ink breaks the Flarefish's fix, exactly as it breaks the
// Lanternjaw's.
//
// The close sight line is posed instantly (`arrange`); the fix, the ink, the broken fix
// and the break-away that follows are the real sim, so they are `act` and are what the
// clip shows. The forager swims clear of its own cloud afterwards so the evidence shows a
// hunter and a forager on either side of the ink rather than both buried in it — see
// `lanternjaw/ink-shakes`, which does the same, and `findInkStandoff`.
import {
  DIR_KEY,
  denAllExcept,
  findInkStandoff,
  pred,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let line;
  let fixed;
  let afterInk;

  return {
    id: "flarefish.ink-breaks",

    async arrange(api) {
      const snap = await startPlaying(api);
      // gap 2: the Flarefish stands inside the 80 px cloud, the least ambiguous form of
      // "blinded by ink" the spec describes.
      line = findInkStandoff(snap, { gap: 2 });
      await denAllExcept(api, ["flarefish"]);
      await api.call("setPredator", "flarefish", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "wander",
      });
      // Facing the way it will break away (see `lanternjaw/ink-shakes` for why), and the
      // board left un-stripped so the swim cannot clear the maze mid-clip.
      await api.call("setForager", {
        tx: line.ink.tx,
        ty: line.ink.ty,
        dir: line.flee,
      });
      await api.call("setBrightness", 1);
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      fixed = pred(await api.snapshot(), "flarefish").state;
      await api.call("clearCooldowns");
      await api.call("press", "ShiftLeft");
      await api.advance(24); // 24 ticks = the old 0.2 s
      afterInk = pred(await api.snapshot(), "flarefish").state;
      // Break away: 100 ticks at 128 px/s is the three tiles it takes to get clear of an
      // 80 px cloud centered where the forager stood.
      await api.call("keyDown", DIR_KEY[line.flee]);
      await api.advance(100);
      await api.call("keyUp", DIR_KEY[line.flee]);
      await api.advance(40); // a beat with the cloud between them, for the clip
    },

    async assert(api, check) {
      check.expectEq(
        "the Flarefish is fixed on the forager first",
        fixed,
        "chase",
      );
      check.expectEq("ink breaks the Flarefish's fix", afterInk, "wander");
    },
  };
}
