// lanternjaw.ink-shakes: ink between the Lanternjaw and the forager breaks its fix.
//
// The close, lit sight line is posed instantly (`arrange`); the fix, the ink drop, the
// broken fix and the break-away that follows are the real sim, so they are `act` and are
// what the clip shows.
//
// WHY THE FORAGER SWIMS OFF AFTERWARDS. Ink is released centered on the forager
// (`specs/gameplay.md`), so a scenario that poses the two two tiles apart and inks has
// both of them standing in the same cloud — and then, because the forager was parked, the
// blinded Lanternjaw simply wanders into it and eats it, which is where the clip used to
// end. Nothing about that is wrong, but it is not a picture of ink working. Driving the
// forager away once the verdict is read leaves the cloud squarely between them and shows
// what breaking a fix actually buys you: the hunter loses the line and the forager
// leaves. The assertions are taken before the first key goes down, so none of this can
// change what the item decides. See `findInkStandoff`.
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
    id: "lanternjaw.ink-shakes",

    async arrange(api) {
      const snap = await startPlaying(api);
      // gap 2: the Lanternjaw stands inside the 80 px cloud the forager is about to drop,
      // which is the least ambiguous form of "blinded by ink" the spec describes.
      line = findInkStandoff(snap, { gap: 2 });
      await denAllExcept(api, ["lanternjaw"]);
      await api.call("setPredator", "lanternjaw", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "wander",
      });
      // Facing the way it will break away, so a build whose resting forager swims on its
      // own (see `parkForager`) drifts away from the hunter rather than into it. The board
      // is deliberately NOT stripped to a last plankton here: the forager swims several
      // tiles in `act`, and on a stripped board that would clear the maze mid-clip.
      await api.call("setForager", {
        tx: line.ink.tx,
        ty: line.ink.ty,
        dir: line.flee,
      });
      await api.call("setBrightness", 1);
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      fixed = pred(await api.snapshot(), "lanternjaw").state;
      await api.call("clearCooldowns");
      await api.call("press", "ShiftLeft"); // drop ink at the forager
      await api.advance(24); // 24 ticks = the old 0.2 s
      afterInk = pred(await api.snapshot(), "lanternjaw").state;
      // Break away: 100 ticks at 128 px/s is three tiles, which is what it takes to get
      // clear of an 80 px cloud centered where the forager stood.
      await api.call("keyDown", DIR_KEY[line.flee]);
      await api.advance(100);
      await api.call("keyUp", DIR_KEY[line.flee]);
      await api.advance(40); // a beat with the cloud between them, for the clip
    },

    async assert(api, check) {
      check.expectEq(
        "the Lanternjaw is fixed on the forager first",
        fixed,
        "chase",
      );
      check.expectEq(
        "ink between them breaks the Lanternjaw's fix",
        afterInk,
        "wander",
      );
    },
  };
}
