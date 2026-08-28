// maze-movement.reverse-anytime: reversal is allowed away from a tile center.
//
// Standing the forager inside a straight run is instant (`arrange`); getting it moving,
// pressing the opposite key mid-tile and reading the new heading is the real sim, so it
// is `act`. The reverse key stays held through the tail so the clip shows the forager
// actually swimming back the way it came.
//
// ONE KEY AT A TIME. The forward key is RELEASED before the opposite is pressed, which
// is both what a player does and the only thing the specs pin down. Holding two opposing
// direction keys at once asks which of them wins — and nothing in `specs/movement.md`
// says: it defines a single "desired direction" that the keys set, and never states how
// a build breaks a tie between two held keys. Resolving that tie newest-first and
// oldest-first are both conforming, so an earlier form of this check — which pressed the
// opposite while still holding the forward key — was not measuring "reversal is allowed
// mid-tile" at all, and failed builds whose reversal is exactly right.
import {
  startPlaying,
  poseMaze,
  DIR_KEY,
  OPP,
  DIRS,
} from "../_helpers.mjs";

export default function item() {
  let run;
  let moving;
  let rev;

  return {
    id: "maze-movement.reverse-anytime",

    async arrange(api) {
      await startPlaying(api);
      // A straight corridor with corridor on BOTH sides of the start tile `S`, so the
      // forager can swim forward and then reverse without either heading meeting rock.
      // `specs/maze.md` fixes no run length, so the run is posed rather than hunted for.
      // Room on BOTH sides of `S`: three tiles of forward run to be seen swimming down
      // before the reversal, and enough behind it to swim back through for the tail.
      const board = await poseMaze(api, ["......S........"]);
      run = { ...board.mark("S"), dir: "right" };
      await api.call("setForager", { tx: run.tx, ty: run.ty });
    },

    async act(api) {
      await api.call("keyDown", DIR_KEY[run.dir]);
      // 72 ticks = 0.6 s of swimming BEFORE the reversal, and the whole point of the length
      // is the clip: this item is about a forager turning around, so a reviewer has to watch
      // it going one way first. The old 12 ticks was 0.1 s — two or three frames at the 25 fps
      // the record pass writes — so the clip opened on a forager that had all but already
      // turned, and the reversal it is named for was over before the eye caught it.
      //
      // 72 rather than a round tile count because the reversal has to land MID-TILE (the rule
      // is that it needs no junction). At 128 px/s a tile is 30 ticks, so any multiple of 30
      // would park the forager exactly on a center — the one place a turn is unremarkable.
      // 72 ticks is 76.8 px: two tiles and 12.8 px, the same offset into a tile the old 12
      // ticks reached, two tiles further down the corridor.
      await api.advance(72);
      moving = (await api.snapshot()).forager;
      // Still mid-tile: let go of forward and press the opposite, so exactly one
      // direction key is held and the reversal is the only thing under test.
      await api.call("keyUp", DIR_KEY[run.dir]);
      await api.call("keyDown", DIR_KEY[OPP[run.dir]]);
      await api.advance(6); // 6 ticks = the old 0.05 s
      rev = (await api.snapshot()).forager;
      await api.advance(96); // 96 ticks = the old 800 ms live tail, the reverse key held
      await api.call("keyUp", DIR_KEY[OPP[run.dir]]);
    },

    async assert(api, check) {
      check.expectEq("the forager is heading forward", moving.dir, run.dir);
      check.expectEq(
        "pressing the opposite reverses the forager immediately (mid-tile)",
        rev.dir,
        OPP[run.dir],
      );
    },
  };
}
