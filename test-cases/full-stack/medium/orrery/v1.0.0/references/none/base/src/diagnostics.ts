// Orrery — the values the debug overlay reports (specs/instrumentation.md
// "Diagnostics").
//
// A registry of named sources, each a PURE READ of the live game, so watching
// the overlay leaves the game exactly as it is and a session that shows it
// reaches the same state as one that never does. Each source reads the state at
// the moment it is read rather than closing over a value, so the panel reports
// the frame being drawn.
//
// The overlay draws whatever is registered here, so adding a line to the panel
// is registering one more source. Keep each short enough to read on a line.

import { challengeCount } from "./challenges";
import { machinePeriod } from "./machine";
import { machineCost } from "./parts";
import type { Game } from "./game";

/** One line of the panel: a short label and the value read at the draw. */
export interface DiagnosticSource {
  readonly label: string;
  read(): string;
}

export class Diagnostics {
  private readonly sources: DiagnosticSource[] = [];

  /** Register one source. `read` runs at each draw and changes nothing. */
  register(label: string, read: () => string): void {
    this.sources.push({ label, read });
  }

  /** Every registered source, read now, in registration order. */
  lines(): { label: string; value: string }[] {
    return this.sources.map((source) => ({
      label: source.label,
      value: source.read(),
    }));
  }
}

/**
 * Register the sources specs/instrumentation.md asks the overlay to show: the
 * screen and mode, the open challenge's name and source, the part count and
 * cost, the period, the run's status, cycle, fraction, and speed, each
 * product's tally against the target, the mote count, the banked area, the
 * fault kind, the focus, and the pointer position — the same facts the
 * snapshot reports.
 */
export function registerGameDiagnostics(
  diagnostics: Diagnostics,
  game: Game,
): void {
  const state = (): Game["state"] => game.state;
  const dash = "—";

  diagnostics.register("screen", () => state().screen);
  diagnostics.register("mode", () => state().mode);
  diagnostics.register("challenge", () => state().challenge?.name ?? dash);
  diagnostics.register("source", () => {
    const current = state();
    if (current.challenge === null) return dash;
    const ref = current.challengeRef;
    return ref === null ? "custom" : `${ref.mode} ${ref.index + 1}`;
  });
  diagnostics.register("parts", () => String(state().editor.parts.length));
  diagnostics.register("cost", () => String(machineCost(state().editor.parts)));
  diagnostics.register("period", () =>
    String(machinePeriod(state().editor.parts)),
  );
  diagnostics.register("status", () => state().sim?.status ?? dash);
  diagnostics.register("cycle", () => {
    const sim = state().sim;
    return sim === null ? dash : String(sim.cycle);
  });
  diagnostics.register("fraction", () => {
    const sim = state().sim;
    return sim === null ? dash : sim.fraction.toFixed(3);
  });
  diagnostics.register("speed", () => {
    const sim = state().sim;
    return sim === null ? dash : String(sim.speed);
  });
  diagnostics.register("tallies", () => {
    const current = state();
    if (current.sim === null || current.challenge === null) return dash;
    return current.sim.tallies
      .map((tally) => `${tally}/${current.challenge?.target ?? 0}`)
      .join(" ");
  });
  diagnostics.register("motes", () => String(state().sim?.motes.length ?? 0));
  diagnostics.register("area", () =>
    String(state().sim?.areaHexes.length ?? 0),
  );
  diagnostics.register("fault", () => state().sim?.fault?.kind ?? dash);
  diagnostics.register("focus", () => state().editor.focus);
  diagnostics.register("pointer", () => {
    const at = state().pointer;
    return `${at.x.toFixed(0)}, ${at.y.toFixed(0)}${at.down ? " down" : ""}`;
  });
  diagnostics.register("course", () => String(challengeCount("campaign")));
  diagnostics.register("autoStep", () => String(state().autoStep));
  diagnostics.register("simTime", () => state().simTime.toFixed(2));
}
