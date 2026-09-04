// Meltdown — the values the engine's debug overlay draws.
//
// specs/instrumentation.md lists what the overlay must show; registering them
// is the whole of Meltdown's part, and drawing the panel, toggling it with the
// backtick key and keeping it read-only are the engine's.
//
// Every source reads the state it is HANDED rather than the one `initialize`
// built, because each frame replaces the state and a source that closed over
// the opening one would report the title screen forever. Every source is a pure
// read, so watching the overlay leaves the game exactly as it is.

import { routesOf } from "./routes";
import { tileAt } from "./geometry";
import { waveCountOf } from "./modes";
import { redlineOf } from "./stats";
import type { InitApi } from "@test-cabinet/simple-2d";
import type { MeltdownState } from "./game";

export function registerDiagnostics(api: InitApi<MeltdownState>): void {
  api.diagnostics.register("screen", (s) => `${s.screen} / ${s.phase}`);
  api.diagnostics.register("mode", (s) => `${s.mode} / ${s.difficulty}`);
  api.diagnostics.register(
    "run",
    (s) =>
      `money ${s.money} lives ${s.lives} wave ${s.wave}/${waveCountOf(
        s.mode,
        s.difficulty,
      )} score ${s.score}`,
  );
  api.diagnostics.register("routes", (s) => {
    const routes = routesOf(s.towers);
    return `left ${routes.leftLength.toFixed(2)} top ${routes.topLength.toFixed(2)}`;
  });
  api.diagnostics.register("towers", (s) =>
    s.towers.length === 0
      ? "none"
      : s.towers
          .map(
            (t) =>
              `#${t.id} ${t.type} L${t.level} h${t.heat.toFixed(1)}/${redlineOf(
                t.type,
              )} ${t.tripped ? "TRIPPED" : "on"} k${t.kills}`,
          )
          .join("  "),
  );
  api.diagnostics.register("surge", (s) =>
    s.surge.length === 0
      ? "none"
      : s.surge
          .map((u) => {
            const tile = tileAt(u.x, u.y);
            return `#${u.id} ${u.type} (${tile.col},${tile.row}) hp${u.hp.toFixed(
              0,
            )}${u.slowFactor > 0 ? " slowed" : ""}`;
          })
          .join("  "),
  );
}
