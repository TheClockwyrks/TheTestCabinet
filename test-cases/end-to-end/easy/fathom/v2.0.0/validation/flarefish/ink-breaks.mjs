// flarefish.ink-breaks: ink breaks the Flarefish's fix, exactly as it breaks the
// Lanternjaw's.
//
// The close sight line is posed instantly (`arrange`); the fix, the ink, the broken fix
// and the break-away that follows are the real sim, so they are `act` and are what the
// clip shows. The forager swims clear of its own cloud afterwards so the evidence shows a
// hunter and a forager on either side of the ink rather than both buried in it — see
// `lanternjaw/ink-shakes`, which does the same, and `findInkStandoff`.
//
// WHEN THE FIX HAS TO BE GONE BY: see `untilGivesUp`. The specs describe losing a fix two
// ways — blinded and wandering on the instant, or holding the chase while it walks to the
// stale fix and waits out its linger — so this waits long enough for either and asks only
// that it gives up.
//
// AND WHY THE FORAGER RETREATS EXACTLY THREE TILES AND THEN STOPS DEAD. It has to move at
// all because a hunter walking to the tile it last saw the forager on walks INTO a forager
// that stayed there, and the scenario ends in a caught life rather than a verdict. Three
// tiles is what clears the `80 px` cloud, and it must not be a step more: the forager is
// faster than the hunter (`128` against `116 px/s`), so one that keeps swimming simply
// outruns the `R = 128 + 192 G` the hunter can see it within — and then a build that
// IGNORED the ink loses the fix honestly, on distance, and passes an item it should fail.
// That is not hypothetical: it is what a first cut of this check did, and a mutant with the
// ink blinding removed sailed through it.
//
// So the retreat is bounded, and the forager is then PARKED against rock — it cannot be
// left merely key-less, because a build that keeps swimming with no key held
// (`specs/movement.md`, see `parkForager`) would carry it out of range just the same. Three
// tiles from the stale fix, in plain sight down a straight corridor, is a forager that any
// hunter still holding a fix would close on and catch. So the two outcomes separate
// cleanly: a hunter the ink blinded stops at the stale fix and gives up where it stands,
// and one it did not comes and takes the life.
import {
  DIR_KEY,
  denAllExcept,
  findInkStandoff,
  parkForager,
  pred,
  startPlaying,
  tileGapPx,
  untilGivesUp,
} from "../_helpers.mjs";

export default function item() {
  let line;
  let gap;
  let fixed;
  let broke;

  return {
    id: "flarefish.ink-breaks",
    // Room to film the ink, the walk to the stale fix and the turn away: the wait itself
    // can run to the linger plus the ground the hunter covers reaching it.
    clipMs: 12000,

    async arrange(api) {
      const snap = await startPlaying(api);
      // gap 2: the Flarefish stands inside the 80 px cloud, the least ambiguous form of
      // "blinded by ink" the spec describes.
      line = findInkStandoff(snap, { gap: 2 });
      // The ground between the hunter and the tile its fix will go stale on, which is what
      // it has to cover before its linger can even start running.
      gap = tileGapPx(snap.grid, line.pred, line.ink);
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
      // Break away: 100 ticks at 128 px/s is the three tiles it takes to get clear of an
      // 80 px cloud centered where the forager stood — and no further (see the header).
      await api.call("keyDown", DIR_KEY[line.flee]);
      await api.advance(100);
      await api.call("keyUp", DIR_KEY[line.flee]);
      await parkForager(api);
      broke = await untilGivesUp(api, "flarefish", { pathPx: gap });
      await api.advance(40); // a beat with the cloud between them, for the clip
    },

    async assert(api, check) {
      check.expectEq(
        "the Flarefish is fixed on the forager first",
        fixed,
        "chase",
      );
      check.expectOk(
        "ink breaks the Flarefish's fix — it stops hunting and returns to wandering",
        broke.gaveUp,
      );
    },
  };
}
