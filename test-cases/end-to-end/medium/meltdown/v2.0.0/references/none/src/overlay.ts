// Meltdown — the debug overlay.
//
// A panel of named values, toggled by the backtick key and drawn over the
// finished frame (specs/controls.md, specs/instrumentation.md). The GAME names
// the values; this file draws them and owns nothing else about them.
//
// Two properties make it safe to leave on while playing:
//
//   * Every source is called fresh on every draw, and is handed the live state,
//     so the panel reports the game as it stands rather than a snapshot taken
//     when it was registered.
//   * A source that throws is reported in its own line rather than raised, so a
//     broken read cannot take the frame down with it.
//
// It draws in DEVICE space, not the game's logical space: the panel is chrome
// laid over the picture, at a readable size whatever the stage is scaled to.

/** The `KeyboardEvent.code` that shows and hides the panel. */
export const OVERLAY_KEY = "Backquote";

/** The panel's own metrics, in device pixels. */
const PANEL = {
  padding: 8,
  lineHeight: 13,
  fontPx: 10,
  background: "rgba(4, 6, 9, 0.78)",
  color: "#9ff6ff",
  maxLines: 44,
} as const;

/** What the heading line reports about the frame the panel is drawn over. */
export interface FramePosition {
  /** Frames the simulation has run. */
  count: number;
  /** The delta the most recent frame was stepped by, in seconds. */
  dt: number;
}

export class Diagnostics<S> {
  /** Insertion-ordered, so the panel's lines keep the order they were named in. */
  private readonly sources = new Map<string, (state: S) => unknown>();
  private shown = false;

  /** Name a value for the panel. The source is called on every draw. */
  register(name: string, source: (state: S) => unknown): void {
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
  lines(frame: FramePosition, state: S): string[] {
    const lines = [
      `frame ${frame.count}  dt ${(frame.dt * 1000).toFixed(2)}ms`,
    ];
    for (const [name, source] of this.sources) {
      for (const line of read(source, state)) lines.push(`${name} ${line}`);
    }
    return lines.slice(0, PANEL.maxLines);
  }

  /**
   * Draw the panel over the finished frame, in device space.
   *
   * The transform is reset and restored around the whole thing, so the caller
   * hands over a context carrying the game's logical transform and gets it back
   * exactly as it was.
   */
  draw(ctx: CanvasRenderingContext2D, frame: FramePosition, state: S): void {
    if (!this.shown) return;
    const lines = this.lines(frame, state);
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

/** One source, as the lines it contributes: a throwing source is reported. */
function read<S>(source: (state: S) => unknown, state: S): string[] {
  try {
    const value = source(state);
    return Array.isArray(value) ? value.map(format) : [format(value)];
  } catch (error) {
    return [error instanceof Error ? `<${error.message}>` : "<error>"];
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
