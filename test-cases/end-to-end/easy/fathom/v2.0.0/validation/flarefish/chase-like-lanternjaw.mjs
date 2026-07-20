// flarefish.chase-like-lanternjaw: on acquiring you it stops flaring and chases exactly
// like the Lanternjaw; lose it and the flare re-arms.
import { startPlaying, findSightLine, denAllExcept, pred, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("flarefish.chase-like-lanternjaw");
  const snap = await startPlaying(api);
  const line = findSightLine(snap, 3);
  await denAllExcept(api, ["flarefish"]);
  await api.call("setForager", { tx: line.forager.tx, ty: line.forager.ty });
  await api.call("setPredator", "flarefish", { tx: line.pred.tx, ty: line.pred.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  await api.call("setBrightness", 1);
  await api.step(0.05);
  const p = pred(await api.snapshot(), "flarefish");
  check.expectEq("on acquiring, it chases", p.state, "chase");
  check.expectOk("it stops flaring while chasing (chases like the Lanternjaw)", p.flaring === false);

  // Lose it with ink; it drops back to wandering (the flare re-arms).
  await api.call("clearCooldowns");
  await api.call("press", "ShiftLeft");
  await api.step(0.3);
  check.expectEq("losing you returns it to wandering", pred(await api.snapshot(), "flarefish").state, "wander");
  await clip(api, 800);
  return check.verdict();
}
