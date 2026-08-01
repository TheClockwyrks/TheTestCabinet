// flarefish.flare-lock: the flare locks onto the forager anywhere in the bloom, at any
// moment, ignoring walls.
//
// Where the forager has to stand is not known until the flare begins (it is chosen
// relative to where the Flarefish has wandered to), so the wait for the flare, the
// re-pose behind a wall, and the lock that follows are all `act`. Re-posing there uses
// `setForager`, a control op — `reset` would take the clock back and freeze the clip.
import {
  FLARE_RADIUS,
  denAllExcept,
  findFarTile,
  losClear,
  openTiles,
  pred,
  quietBoard,
  startPlaying,
  tileCenter,
} from "../_helpers.mjs";

// An open tile within the flare bloom of `tile` (euclidean < 185 px) whose line of
// sight to it is BLOCKED — so a lock there proves the flare ignores walls.
function blindNear(snap, tile) {
  const a = tileCenter(snap.grid, tile.tx, tile.ty);
  for (const [c, r] of openTiles(snap)) {
    const man = Math.abs(c - tile.tx) + Math.abs(r - tile.ty);
    if (man < 3 || man > 5) continue;
    const p = tileCenter(snap.grid, c, r);
    if (Math.hypot(p.x - a.x, p.y - a.y) > 185) continue;
    if (!losClear(snap, c, r, tile.tx, tile.ty)) return { tx: c, ty: r };
  }
  return null;
}

export default function item() {
  let r;
  let spot;
  let r2;

  return {
    id: "flarefish.flare-lock",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, ["flarefish"]);
      const far = findFarTile(snap, snap.forager, 8, {
        // "Far" here means OUTSIDE the bloom, which is a euclidean radius — a
        // manhattan-8 tile can sit at 181 px, inside it. One tile of margin past
        // FLARE_RADIUS so a Flarefish that has drifted a little is still clear.
        minPx: FLARE_RADIUS + snap.grid.tile,
      });
      await api.call("setPredator", "flarefish", {
        tx: far.tx,
        ty: far.ty,
        mode: "wander",
      });
      await quietBoard(api);
    },

    async act(api) {
      // Wait for the flare to begin. 1140 ticks = the old 9.5 s cap, poll 6 = the old
      // 0.05 s chunk.
      r = await api.until(
        (s) => {
          const p = pred(s, "flarefish");
          return p.flareCharging || p.flaring;
        },
        { max: 1140, poll: 6 },
      );
      const fx = pred(r.snap, "flarefish");
      spot = blindNear(r.snap, { tx: fx.tx, ty: fx.ty });
      if (!spot) return;
      await api.call("setForager", { tx: spot.tx, ty: spot.ty }); // inside the bloom, wall between
      // 180 ticks = the old 1.5 s cap; poll 6 = the old 0.05 s chunk.
      r2 = await api.until((s) => pred(s, "flarefish").state === "chase", {
        max: 180,
        poll: 6,
      });
      await api.advance(108); // 108 ticks = the old 900 ms live tail
    },

    async assert(api, check) {
      check.expectOk("the Flarefish begins a flare", r.hit);
      check.expectOk(
        "a blind spot inside the bloom exists to test the through-wall lock",
        spot !== null,
      );
      if (!spot) return;
      check.expectOk("the flare locks on through the wall (it chases)", r2.hit);
      check.expectOk(
        "the detection alert fires on the flare-lock",
        pred(r2.snap, "flarefish").alert === true,
      );
    },
  };
}
