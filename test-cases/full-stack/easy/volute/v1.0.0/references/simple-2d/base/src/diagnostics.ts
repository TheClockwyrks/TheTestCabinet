// Volute — what the engine's debug overlay shows (specs/instrumentation.md).
//
// The overlay is the engine's: it draws the panel, it owns the backtick key, and
// it keeps the panel read-only. Volute's whole part is naming the values, which
// is what this file does. Each source is handed the state current at the read, as
// `DeepReadonly<VoluteState>`, and reads off that argument alone, so watching the
// overlay leaves the game exactly as it was.
//
// The list is the one specs/instrumentation.md asks for, and each line is short
// enough to read at a glance.

import type { InitApi } from "@test-cabinet/simple-2d";
import type { VoluteState } from "./game";
import { inDanger } from "./sim";
import { effectiveFeed } from "./train";

/** Name every value the overlay carries. */
export function registerDiagnostics(
  api: Pick<InitApi<VoluteState>, "diagnostics">,
): void {
  api.diagnostics.register("screen", (s) => s.screen);
  api.diagnostics.register("level", (s) => `${s.level}  score ${s.score}`);
  api.diagnostics.register("cells", (s) => s.cells);
  api.diagnostics.register("quota", (s) => s.quotaRemaining);
  api.diagnostics.register(
    "pressure",
    (s) => `${s.pressure.toFixed(2)}  feed ${effectiveFeed(s).toFixed(2)}`,
  );
  api.diagnostics.register(
    "chain",
    (s) => `${s.chainStep}  in ${s.chainTimer.toFixed(2)}s`,
  );
  api.diagnostics.register(
    "cores",
    (s) =>
      `${s.cores.length}  head ${
        s.cores.length > 0 ? s.cores[0].s.toFixed(1) : "-"
      }`,
  );
  api.diagnostics.register("segments", (s) => s.segments.length);
  api.diagnostics.register("danger", (s) => (inDanger(s) ? "yes" : "no"));
  api.diagnostics.register(
    "injector",
    (s) =>
      `${s.loaded ?? "-"}/${s.queued ?? "-"}  aim ${s.aim.toFixed(1)}  cd ${s.fireCooldown.toFixed(2)}`,
  );
  api.diagnostics.register("projectiles", (s) => s.projectiles.length);
  api.diagnostics.register("machinery", (s) =>
    s.machinery === null
      ? "none"
      : `${s.machinery.kind} ${s.machinery.remaining.toFixed(2)}s`,
  );
}
