// scoring.caught-costs-life: contact with a predator costs a life and resets the trench.
import { startPlaying, denAllExcept, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.caught-costs-life");
  const snap = await startPlaying(api);
  const before = await api.snapshot();
  const f = before.forager;
  await denAllExcept(api, ["gloamfin"]);
  // Put a chasing predator on the forager's tile so a real collision occurs.
  await api.call("setPredator", "gloamfin", { tx: f.tx, ty: f.ty, mode: "chase" });
  await api.step(0.05);
  const after = await api.snapshot();
  check.expectEq("contact costs a life", after.lives, before.lives - 1);
  check.expectEq("the trench resets (back to the dive countdown)", after.screen, "countdown");
  await clip(api, 700);
  return check.verdict();
}
