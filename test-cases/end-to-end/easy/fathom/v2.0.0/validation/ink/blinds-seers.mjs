// ink.blinds-seers: ink blinds the sight-based Lanternjaw and Flarefish (breaking their
// fix) but does nothing to the sound-based Gloamfin.
import { startPlaying, findSightLine, denAllExcept, pred, clip } from "../_helpers.mjs";

// Acquire a seer via light, drop ink, and report its state before/after the ink.
async function seer(api, kind) {
  const snap = await startPlaying(api);
  const line = findSightLine(snap, 2);
  await denAllExcept(api, [kind]);
  await api.call("setForager", { tx: line.forager.tx, ty: line.forager.ty });
  await api.call("setPredator", kind, { tx: line.pred.tx, ty: line.pred.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  await api.call("setBrightness", 1);
  await api.step(0.05);
  const before = pred(await api.snapshot(), kind).state;
  await api.call("clearCooldowns");
  await api.call("press", "ShiftLeft");
  await api.step(0.2);
  const after = pred(await api.snapshot(), kind).state;
  return { before, after };
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ink.blinds-seers");

  const l = await seer(api, "lanternjaw");
  check.expectEq("the Lanternjaw is fixed before ink", l.before, "chase");
  check.expectEq("ink blinds the Lanternjaw (fix broken)", l.after, "wander");

  const f = await seer(api, "flarefish");
  check.expectEq("the Flarefish is fixed before ink", f.before, "chase");
  check.expectEq("ink blinds the Flarefish (fix broken)", f.after, "wander");

  // The Gloamfin, chasing by sound, is unaffected.
  const snap = await startPlaying(api);
  const line = findSightLine(snap, 3);
  await denAllExcept(api, ["gloamfin"]);
  await api.call("setForager", { tx: line.forager.tx, ty: line.forager.ty });
  await api.call("setPredator", "gloamfin", { tx: line.pred.tx, ty: line.pred.ty, mode: "chase" });
  await api.call("poseLastPlankton");
  await api.step(0.05);
  check.expectEq("the Gloamfin is chasing", pred(await api.snapshot(), "gloamfin").state, "chase");
  await api.call("clearCooldowns");
  await api.call("press", "ShiftLeft");
  await api.step(0.2);
  check.expectEq("ink does not affect the Gloamfin (still chasing)", pred(await api.snapshot(), "gloamfin").state, "chase");
  await clip(api, 700);
  return check.verdict();
}
