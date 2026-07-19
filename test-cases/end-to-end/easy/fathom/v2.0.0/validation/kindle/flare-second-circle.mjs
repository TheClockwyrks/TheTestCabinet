// kindle.flare-second-circle: a Flarefish flare acts as a full-vision second circle,
// drawing the trench inside its bloom even beyond the forager's vision circle.
import {
  startPlaying,
  denAllExcept,
  findFarTile,
  openTiles,
  tileCenter,
  pred,
  stepUntil,
  sampleColor,
  luminance,
  clip,
} from "../_helpers.mjs";

const man = (a, b, c, d) => Math.abs(a - c) + Math.abs(b - d);

export default async function drive(api, ttc) {
  const check = ttc.checkOne("kindle.flare-second-circle");
  const snap = await startPlaying(api);
  await denAllExcept(api, ["flarefish"]);
  const far = findFarTile(snap, snap.forager, 11); // beyond the vision circle, and stays far
  await api.call("setPredator", "flarefish", { tx: far.tx, ty: far.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  const r = await stepUntil(api, (s) => pred(s, "flarefish").flaring === true, 9.5, 0.1);
  check.expectOk("the Flarefish flares", r.hit);
  const s = r.snap;
  const fx = pred(s, "flarefish");
  const distF = Math.hypot(fx.x - s.forager.x, fx.y - s.forager.y);
  check.expectGt("the Flarefish is beyond the forager's vision circle", distF, s.windowRadius);

  // A tile within the flare bloom (close to the Flarefish) but beyond the vision circle.
  let near = null;
  for (const [c, r2] of openTiles(s)) {
    if (man(c, r2, fx.tx, fx.ty) < 1 || man(c, r2, fx.tx, fx.ty) > 3) continue;
    const p = tileCenter(s.grid, c, r2);
    if (Math.hypot(p.x - s.forager.x, p.y - s.forager.y) > s.windowRadius + 16) {
      near = { c, r: r2, p };
      break;
    }
  }
  check.expectOk("found a bloom tile beyond the vision circle", Boolean(near));
  if (!near) return check.verdict();
  await api.wait(150);
  const col = await sampleColor(api, near.p.x, near.p.y);
  // A far fog tile for reference.
  const fog = openTiles(s).find(([c, r2]) => s.visibility[r2][c] === "u" && man(c, r2, fx.tx, fx.ty) > 8);
  const fogCol = fog
    ? await sampleColor(api, tileCenter(s.grid, fog[0], fog[1]).x, tileCenter(s.grid, fog[0], fog[1]).y)
    : { r: 3, g: 6, b: 12 };
  check.expectGt(
    "the flare draws the trench beyond the vision circle",
    luminance(col),
    luminance(fogCol) + 6,
  );
  await clip(api, 800);
  return check.verdict();
}
