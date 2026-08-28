// maze-movement.turn-at-center: a buffered perpendicular turn is taken at the tile
// center, not mid-tile.
//
// Standing the forager behind the junction is instant (`arrange`); approaching it,
// buffering the turn mid-tile and reaching the center where the turn is actually taken is
// the real sim, so it is `act` — and that is exactly the clip a reviewer needs to see.
//
// ONE KEY AT A TIME. The approach key is RELEASED before the perpendicular is pressed.
// `specs/movement.md` says a direction key "sets the desired direction" and that the
// desired direction is buffered — "hold or tap a direction slightly before a junction and
// the forager takes it at the junction" — so a tap of the perpendicular is exactly the
// input the rule describes. It says nothing about which of two simultaneously held keys
// wins, so an earlier form of this check — which pressed the perpendicular while still
// holding the approach key — rode on an unspecified tie-break: against a build that
// resolves it oldest-first the forager simply never turned, which ALSO made the
// "not taken mid-tile" assertion pass for the wrong reason.
import { startPlaying, poseMaze, DIR_KEY } from "../_helpers.mjs";

// A right-angle junction: the forager starts at `B`, swims right into the junction `J`,
// and the buffered turn takes it down the arm below. `B` is the tile immediately behind
// the junction, because the timings in `act` are measured from one tile out: the forager
// buffers the turn 14 ticks in — `14.9 px`, mid-tile and short of the `16 px` half-tile —
// and reaches the center over the 36 that follow. The corridor CONTINUES past `J`, so a
// forager that never takes the turn swims straight on rather than being stopped by rock;
// the turn has to be the thing that moves it. Three tiles of arm give the turn somewhere
// to go. Which junctions a maze offers, and how much room sits either side of them, is
// the build's own invention (`specs/maze.md`), so the corner this item is named for is
// posed rather than found.
const CORNER = [
  "BJ.",
  " . ",
  " . ",
  " . ",
];

export default function item() {
  let c;
  let mid;
  let turned;

  return {
    id: "maze-movement.turn-at-center",

    async arrange(api) {
      await startPlaying(api);
      const board = await poseMaze(api, CORNER);
      const j = board.mark("J");
      c = {
        junction: j,
        approach: "right",
        back: board.mark("B"),
        perp: "down",
        perpTile: { tx: j.tx, ty: j.ty + 1 },
      };
      // Approach the junction from the tile behind it.
      await api.call("setForager", { tx: c.back.tx, ty: c.back.ty });
    },

    async act(api) {
      await api.call("keyDown", DIR_KEY[c.approach]);
      // The old step(0.12) is 14.4 ticks, which the contract refuses to round, and the
      // choice matters here: at 128 px/s, 14 ticks is 14.93 px — still short of the 16 px
      // half-tile, so the forager is genuinely mid-tile as the comment requires. 15 ticks
      // would be 16 px, reaching the junction center and destroying the very invariant
      // this check probes. So: 14.
      await api.advance(14); // ~14.9 px in: mid-tile, short of the junction center
      // Buffer the perpendicular turn while mid-tile, with only that key held.
      await api.call("keyUp", DIR_KEY[c.approach]);
      await api.call("keyDown", DIR_KEY[c.perp]);
      mid = (await api.snapshot()).forager;
      await api.advance(36); // 36 ticks = the old 0.3 s: reach the junction center — the turn is taken there
      turned = (await api.snapshot()).forager;
      await api.advance(96); // 96 ticks = the old 800 ms live tail, the turn key held
      await api.call("keyUp", DIR_KEY[c.perp]);
    },

    async assert(api, check) {
      check.expectEq(
        "the buffered turn is NOT taken mid-tile (still on the approach heading)",
        mid.dir,
        c.approach,
      );
      check.expectEq(
        "the turn onto the perpendicular arm is taken",
        turned.dir,
        c.perp,
      );
      const at = `${turned.tx},${turned.ty}`;
      const ok =
        at === `${c.junction.tx},${c.junction.ty}` ||
        at === `${c.perpTile.tx},${c.perpTile.ty}`;
      check.expectOk(
        "the turn was taken at the junction center, not earlier",
        ok,
      );
    },
  };
}
