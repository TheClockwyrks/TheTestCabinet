// gloamfin.ping-reveals-nothing: its own ping reveals no terrain (only its violet
// wavefront is visible) and it does not draw itself.
import { startPlaying, denAllExcept, findFarTile, pred, clip } from "../_helpers.mjs";

// Tiles revealed FAR from the forager (beyond the reach of the local passive light) —
// any such revealed tile would have to come from something other than the light.
function farRevealed(s) {
  let n = 0;
  for (let r = 0; r < s.grid.rows; r++) {
    for (let c = 0; c < s.grid.cols; c++) {
      const v = s.visibility[r][c];
      if ((v === "l" || v === "r") && Math.abs(c - s.forager.tx) + Math.abs(r - s.forager.ty) > 5) n++;
    }
  }
  return n;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gloamfin.ping-reveals-nothing");
  const snap = await startPlaying(api);
  await denAllExcept(api, ["gloamfin"]);
  const far = findFarTile(snap, snap.forager, 11); // beyond its ping range, so no acquire
  await api.call("setPredator", "gloamfin", { tx: far.tx, ty: far.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  // Step until the Gloamfin's ping is well in flight.
  let pinged = false;
  let last = snap;
  for (let i = 0; i < 200; i++) {
    await api.step(0.05);
    last = await api.snapshot();
    if (last.pulses.some((p) => p.source === "gloamfin" && p.front > 2)) {
      pinged = true;
      break;
    }
  }
  check.expectOk("the Gloamfin emitted a violet ping wavefront", pinged);
  check.expectEq("its ping reveals no terrain out in the dark", farRevealed(last), 0);
  check.expectOk("it does not draw itself (unlit in the fog)", pred(last, "gloamfin").lit === false);
  await clip(api, 900);
  return check.verdict();
}
