// amber.lookalikes: the bonus drifter and the Lanternjaw's bulb render as near-
// identical amber lights (sampled from the rendered canvas). Both are posed far out
// in the dark, away from the forager's light pocket, so each amber halo is read over
// the same unlit fog and the two readings can be compared like for like.
import {
  startPlaying,
  openTiles,
  tileCenter,
  denAllExcept,
  pred,
  sampleAmberOrb,
  colorDistance,
  isAmber,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("amber.lookalikes");
  const snap = await startPlaying(api);
  // Two open tiles a couple of tiles apart in a mid-range ring around the forager:
  // beyond the light pocket (~130 px) so each amber halo reads over near-dark ground,
  // yet inside the Kindle vision circle (192 px at rest) so both lights are drawn in
  // BOTH dives (in Kindle an amber glimmer is clipped to that circle). Both halos then
  // sit over comparable dark ground and can be compared like for like.
  const fc = tileCenter(snap.grid, snap.forager.tx, snap.forager.ty);
  const inBand = ([c, r]) => {
    const p = tileCenter(snap.grid, c, r);
    const d = Math.hypot(p.x - fc.x, p.y - fc.y);
    return d >= 140 && d <= 180;
  };
  const band = openTiles(snap).filter(inBand);
  const a = band[0];
  const b = band.find(([c, r]) => Math.abs(c - a[0]) + Math.abs(r - a[1]) >= 2);
  if (!a || !b) throw new Error("no two mid-range tiles for the amber lights");
  await denAllExcept(api, ["lanternjaw"]);
  await api.call("setPredator", "lanternjaw", { tx: a[0], ty: a[1], mode: "wander" });
  await api.call("spawnDrifter", { tx: b[0], ty: b[1] });
  await api.call("poseLastPlankton");
  await api.step(0.02);
  const s = await api.snapshot();
  const lj = pred(s, "lanternjaw");
  const dr0 = s.drifters[0];
  check.expectOk("a drifter is present", Boolean(dr0));
  await api.wait(120);
  const bulb = await sampleAmberOrb(api, lj.x, lj.y);
  const drift = await sampleAmberOrb(api, dr0.x, dr0.y);
  check.expectOk("the Lanternjaw's bulb is amber", isAmber(bulb));
  check.expectOk("the drifter is amber", isAmber(drift));
  check.expectLt("the two amber lights are near-identical", colorDistance(bulb, drift), 70);
  await api.screenshot("amber");
  return check.verdict();
}
