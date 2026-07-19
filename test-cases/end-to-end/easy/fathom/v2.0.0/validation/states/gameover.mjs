// states.gameover: losing the last life reaches the game-over screen.
import { startPlaying, denAllExcept } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.gameover");
  await startPlaying(api);
  await denAllExcept(api, ["gloamfin"]);
  for (let i = 0; i < 8; i++) {
    let s = await api.snapshot();
    if (s.screen === "gameover") break;
    if (s.screen === "countdown") {
      await api.call("beginPlay");
      s = await api.snapshot();
    }
    if (s.screen !== "playing") break;
    const f = s.forager;
    await api.call("setPredator", "gloamfin", { tx: f.tx, ty: f.ty, mode: "chase" });
    await api.step(0.05);
  }
  check.expectEq("losing the last life reaches game over", (await api.snapshot()).screen, "gameover");
  await api.wait(150);
  await api.screenshot("gameover");
  return check.verdict();
}
