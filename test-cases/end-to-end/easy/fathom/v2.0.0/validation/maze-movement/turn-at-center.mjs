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
import { startPlaying, findCorner, DIR_KEY } from "../_helpers.mjs";

export default function item() {
  let c;
  let mid;
  let turned;

  return {
    id: "maze-movement.turn-at-center",

    async arrange(api) {
      const snap = await startPlaying(api);
      c = findCorner(snap);
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
