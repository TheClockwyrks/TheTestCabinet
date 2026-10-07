// Spectra — the diagnostics overlay.
//
// A panel of named values, toggled by the backtick key and drawn over the finished
// frame (specs/instrumentation.md, specs/controls.md). The game NAMES the values;
// this file draws them and owns nothing else about them.
//
// Two properties make it safe to leave on while playing:
//
//   * Every source is called fresh on every draw, so the panel reports the live
//     game rather than a snapshot taken when it was registered.
//   * A source that throws is reported in its own line rather than raised, so a
//     broken read cannot take the frame down with it.
//
// It draws in DEVICE space, not the game's logical space: the panel is chrome laid
// over the picture, at a readable size whatever the stage is scaled to, and it
// must not move when the window is resized.

/** The panel's own metrics, in device pixels. */
const PANEL = {
  padding: 8,
  lineHeight: 14,
  fontPx: 11,
  background: "rgba(0, 0, 0, 0.68)",
  color: "#8ef0ff",
} as const;

/** What the heading line reports about the frame the panel is drawn over. */
export interface FramePosition {
  /** Frames the simulation has run. */
  count: number;
  /** The delta the most recent frame was stepped by, in seconds. */
  dt: number;
}

export class Diagnostics {
  /** Insertion-ordered, so the panel's lines keep the order they were named in. */
  private readonly sources = new Map<string, () => unknown>();
  private shown = false;

  /** Name a value for the panel. The source is called on every draw. */
  register(name: string, source: () => unknown): void {
    this.sources.set(name, source);
  }

  /** Whether the panel is currently shown. */
  visible(): boolean {
    return this.shown;
  }

  /** Show the panel if it is hidden, hide it if it is shown. */
  toggle(): void {
    this.shown = !this.shown;
  }

  /** Every line the panel would draw, heading first. A pure read. */
  lines(frame: FramePosition): string[] {
    return [
      `frame ${frame.count}  dt ${(frame.dt * 1000).toFixed(2)}ms`,
      ...[...this.sources].map(([name, source]) => `${name} ${read(source)}`),
    ];
  }

  /**
   * Draw the panel over the finished frame, in device space.
   *
   * The transform is reset and restored around the whole thing, so the caller
   * hands over a context carrying the game's logical transform and gets it back
   * exactly as it was.
   */
  draw(ctx: CanvasRenderingContext2D, frame: FramePosition): void {
    if (!this.shown) return;
    const lines = this.lines(frame);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${PANEL.fontPx}px monospace`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    const width =
      Math.max(...lines.map((line) => ctx.measureText(line).width)) +
      PANEL.padding * 2;
    ctx.fillStyle = PANEL.background;
    ctx.fillRect(
      0,
      0,
      width,
      lines.length * PANEL.lineHeight + PANEL.padding * 2,
    );
    ctx.fillStyle = PANEL.color;
    lines.forEach((line, index) => {
      ctx.fillText(
        line,
        PANEL.padding,
        PANEL.padding + index * PANEL.lineHeight,
      );
    });
    ctx.restore();
  }
}

/** One source, as a short line: a throwing source is reported, not raised. */
function read(source: () => unknown): string {
  try {
    return format(source());
  } catch (error) {
    return error instanceof Error ? `<${error.message}>` : "<error>";
  }
}

/** A diagnostic value as one short line of the panel. */
function format(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}
