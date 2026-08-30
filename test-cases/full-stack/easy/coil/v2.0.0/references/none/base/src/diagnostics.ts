// Coil — the values the diagnostics overlay reports (specs/instrumentation.md).
//
// A registry of named sources, each a pure read of the game. The overlay draws
// whatever is registered here, so watching it leaves the game exactly as it is, and
// adding a line to the panel is registering one more source.

export interface DiagnosticSource {
  label: string;
  read(): string;
}

export class Diagnostics {
  private readonly sources: DiagnosticSource[] = [];

  /** Register one source. `read` is called at each draw and changes nothing. */
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
