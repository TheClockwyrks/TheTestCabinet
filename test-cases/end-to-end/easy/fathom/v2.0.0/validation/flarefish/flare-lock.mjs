// flarefish.flare-lock: the flare locks onto the forager anywhere in the bloom, at any
// moment, ignoring walls.
import {
  startPlaying,
  denAllExcept,
  findFarTile,
  openTiles,
  tileCenter,
  losClear,
  pred,
  stepUntil,
  clip,
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

export default async function drive(api, ttc) {
  const check = ttc.checkOne("flarefish.flare-lock");
  const snap = await startPlaying(api);
  await denAllExcept(api, ["flarefish"]);
  const far = findFarTile(snap, snap.forager, 8);
  await api.call("setPredator", "flarefish", { tx: far.tx, ty: far.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  // Wait for the flare to begin.
  const r = await stepUntil(
    api,
    (s) => {
      const p = pred(s, "flarefish");
      return p.flareCharging || p.flaring;
    },
    9.5,
    0.05,
  );
  check.expectOk("the Flarefish begins a flare", r.hit);
  const fx = pred(r.snap, "flarefish");
  const spot = blindNear(r.snap, { tx: fx.tx, ty: fx.ty });
  check.expectOk("a blind spot inside the bloom exists to test the through-wall lock", spot !== null);
  if (!spot) return check.verdict();
  await api.call("setForager", { tx: spot.tx, ty: spot.ty }); // inside the bloom, wall between
  const r2 = await stepUntil(api, (s) => pred(s, "flarefish").state === "chase", 1.5, 0.05);
  check.expectOk("the flare locks on through the wall (it chases)", r2.hit);
  check.expectOk("the detection alert fires on the flare-lock", pred(r2.snap, "flarefish").alert === true);
  await clip(api, 900);
  return check.verdict();
}
