// Volute — the debug overlay (specs/instrumentation.md "Diagnostics").
//
// A panel of named values, toggled by the backtick key and drawn over the finished
// frame. The game NAMES the values; this file draws them and owns nothing else
// about them.
//
// Two properties make it safe to leave on while playing:
//
//   * Every source is called fresh on every draw, so the panel reports the live
//     game rather than a reading taken when it was registered.
//   * A source that throws is reported on its own line rather than raised, so a
//     broken read cannot take the frame down with it.
//
// It draws in DEVICE space, not the game's logical space: the panel is chrome laid
// over the picture, at a readable size whatever the field is scaled to.

/** The panel's own metrics, in device pixels. */
const PANEL = {
  padding: 8,
  lineHeight: 15,
  fontPx: 12,
  background: "rgba(6, 10, 13, 0.82)",
  border: "rgba(61, 74, 84, 0.9)",
  color: "#ffcd8c",
} as const;

/** The named, read-only sources the panel shows. */
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

  /** One line per named source, in naming order. A pure read. */
  lines(): string[] {
    return [...this.sources].map(([name, source]) => `${name} ${read(source)}`);
  }

  /**
   * Draw the panel over the finished frame, in device space.
   *
   * The transform is reset and restored around the whole thing, so the caller
   * hands over a context carrying the game's logical transform and gets it back
   * exactly as it was.
   */
  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.shown) return;
    const lines = this.lines();
    // Nothing named is nothing to show: the panel is sized from its widest line,
    // and an empty list has no widest line to size it from.
    if (lines.length === 0) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${PANEL.fontPx}px monospace`;
    ctx.textBaseline = "top";
    const width =
      Math.max(...lines.map((line) => ctx.measureText(line).width)) +
      PANEL.padding * 2;
    const height = lines.length * PANEL.lineHeight + PANEL.padding * 2;
    ctx.fillStyle = PANEL.background;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = PANEL.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
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
  if (value === null) return "none";
  return JSON.stringify(value) ?? String(value);
}
