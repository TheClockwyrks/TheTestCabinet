// scoring.three-lives: the dive starts with three lives; losing them all ends the game.
import { startPlaying, denAllExcept, START_LIVES, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.three-lives");
  const snap = await startPlaying(api);
  check.expectEq("the dive starts with three lives", snap.lives, START_LIVES);
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
  check.expectEq("losing all lives ends the game", (await api.snapshot()).screen, "gameover");
  await clip(api, 700);
  return check.verdict();
}
