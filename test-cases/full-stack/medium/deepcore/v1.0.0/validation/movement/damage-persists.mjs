// Automated validation for movement.damage-persists.
//
// A tile drilled partway and then abandoned keeps its accrued damage; returning resumes from the
// reduced health rather than restarting. We cut a topsoil tile to about half, release, confirm the
// tile's health holds while idle, then resume and confirm it breaks quickly (fewer hits left).

import { K, newRun, standAt, solid, TOPSOIL_ROW, SPAWN_COL, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.damage-persists");
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;

  await newRun(api);
  await standAt(api, col, row);
  await solid(api, col, row + 2);
  const full = (await api.call("tileAt", col, row + 1)).maxHealth;

  await api.call("keyDown", K.down);
  await api.step(0.25); // ~2 of 4 topsoil hits
  await api.call("keyUp", K.down);
  const midHealth = (await api.call("tileAt", col, row + 1)).health;
  check.expectGt("the tile is partly drilled", midHealth, 0);
  check.expectLt("the tile is not yet broken", midHealth, full);

  await api.step(0.4); // idle: damage must persist on the abandoned tile
  const heldHealth = (await api.call("tileAt", col, row + 1)).health;
  check.expectClose("the accrued damage persists while abandoned", heldHealth, midHealth, 0.01);

  await api.call("keyDown", K.down);
  const r = await stepUntil(api, () => false, 0.5, 0.05); // resume; runs the real cut forward
  void r;
  const cleared = await api.call("tileAt", col, row + 1);
  await api.call("keyUp", K.down);
  check.expectEq("resuming breaks it from the reduced health", cleared.kind, "tunnel");

  await liveClip(api, 700);
  return check.verdict();
}
