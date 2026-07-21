// Automated validation for movement.damage-persists.
//
// A tile drilled partway and then abandoned keeps its accrued damage; returning resumes from the
// reduced health rather than restarting. We cut a topsoil tile to about half, release, confirm the
// tile's health holds while idle, then resume and confirm it breaks quickly (fewer hits left).

import {
  K,
  newRun,
  standAt,
  solid,
  TOPSOIL_ROW,
  SPAWN_COL,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;
  let full;
  let midHealth;
  let heldHealth;
  let cleared;

  return {
    id: "movement.damage-persists",

    // Grounded over an intact topsoil tile, with solid rock beneath it so the shaft is continuous.
    async arrange(api) {
      await newRun(api);
      await standAt(api, col, row);
      await solid(api, col, row + 2);
      full = (await api.call("tileAt", col, row + 1)).maxHealth;
    },

    // Cut, abandon, and resume — the whole point is what happens ACROSS those phases, so all three
    // are timed here and the clip shows the tile surviving the pause and then breaking early.
    async act(api) {
      await api.call("keyDown", K.down);
      await api.advance(15); // 15 ticks = 0.25 s, ~2 of 4 topsoil hits
      await api.call("keyUp", K.down);
      midHealth = (await api.call("tileAt", col, row + 1)).health;

      await api.advance(24); // 24 ticks = 0.4 s idle: damage must persist on the abandoned tile
      heldHealth = (await api.call("tileAt", col, row + 1)).health;

      await api.call("keyDown", K.down);
      // Resume; runs the real cut forward. The old `stepUntil(..., () => false, 0.5, 0.05)` never
      // matched its predicate, so it was only ever a plain 0.5 s advance — 30 ticks.
      await api.advance(30);
      cleared = await api.call("tileAt", col, row + 1);
      await api.call("keyUp", K.down);
    },

    async assert(api, check) {
      check.expectGt("the tile is partly drilled", midHealth, 0);
      check.expectLt("the tile is not yet broken", midHealth, full);
      check.expectClose(
        "the accrued damage persists while abandoned",
        heldHealth,
        midHealth,
        0.01,
      );
      check.expectEq(
        "resuming breaks it from the reduced health",
        cleared.kind,
        "tunnel",
      );
    },
  };
}
