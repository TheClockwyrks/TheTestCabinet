// ink.cooldown: releasing ink starts an ~8 s cooldown before it can be used again.
import { startPlaying, INK_COOLDOWN, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ink.cooldown");
  await startPlaying(api);
  await api.call("clearCooldowns");
  check.expectOk("ink is ready before use", (await api.snapshot()).ink.ready);
  await api.call("press", "ShiftLeft");
  await api.step(0.02);
  const s1 = await api.snapshot();
  check.expectOk("ink is on cooldown right after use", s1.ink.ready === false);
  check.expectClose("the ink cooldown is ~8 s", s1.ink.cooldown, INK_COOLDOWN, 0.4);
  await api.step(INK_COOLDOWN);
  check.expectOk("ink is ready again after the cooldown", (await api.snapshot()).ink.ready);
  await clip(api, 700);
  return check.verdict();
}
