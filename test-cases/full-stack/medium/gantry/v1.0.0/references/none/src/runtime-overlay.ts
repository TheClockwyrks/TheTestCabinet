// The debug overlay.
//
// `specs/instrumentation.md` puts the overlay in the runtime layer: it draws
// the diagnostic sources the game registers, the backtick key (`Backquote`)
// shows and hides it, it is off until toggled, and it reads the game without
// changing it. It is kept visually plain and clearly separate from the game's
// own display — a bordered monospace panel in a corner of the page, over the
// canvas rather than in it, and inert to the pointer so it never eats a click.
//
// The panel is behind `OverlayView` so the toggling and the reading are plain
// logic that runs in Node; only `createOverlayView` touches the DOM.

/** The key that shows and hides the overlay (`specs/instrumentation.md`). */
export const OVERLAY_TOGGLE_CODE = "Backquote";

/** Somewhere to put the lines. */
export interface OverlayView {
  setVisible(visible: boolean): void;
  setLines(lines: readonly string[]): void;
}

/**
 * The overlay's state: whether it is shown, and the source it reads.
 *
 * `refresh` is called once a frame while the game runs. It calls the source
 * only while the overlay is shown, and writes to the view only when the text
 * has actually changed, so a hidden overlay costs nothing and a shown one
 * neither reads nor writes more than it must. The source is a pure read, so
 * watching the overlay leaves the game as it is.
 */
export class DiagnosticsOverlay {
  private readonly view: OverlayView;
  private source: () => readonly string[] = () => [];
  private shown = false;
  private drawn: string | null = null;

  constructor(view: OverlayView) {
    this.view = view;
    view.setVisible(false);
  }

  /** Register the diagnostic source the overlay draws. */
  setSource(source: () => readonly string[]): void {
    this.source = source;
    this.drawn = null;
    this.refresh();
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Show it if it is hidden, hide it if it is shown. */
  toggle(): void {
    this.shown = !this.shown;
    this.view.setVisible(this.shown);
    this.drawn = null;
    this.refresh();
  }

  /** Read the source and draw it, if anything would change. */
  refresh(): void {
    if (!this.shown) return;
    const lines = this.source();
    const text = lines.join("\n");
    if (text === this.drawn) return;
    this.drawn = text;
    this.view.setLines(lines);
  }
}

/** The panel's own styling: plain, legible, and out of the game's way. */
const PANEL_STYLE = [
  "position: fixed",
  "left: 8px",
  "top: 8px",
  "z-index: 10",
  "margin: 0",
  "padding: 8px 10px",
  "max-width: calc(100vw - 16px)",
  "border: 1px solid #6b7a86",
  "border-radius: 3px",
  "background: rgba(6, 10, 14, 0.86)",
  "color: #d8e4ec",
  "font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  "white-space: pre",
  "overflow: hidden",
  "pointer-events: none",
  "user-select: none",
].join("; ");

/**
 * Put an overlay panel on the page, over the canvas. It is hidden until the
 * backtick key toggles it, and it never takes the pointer.
 */
export function createOverlayView(parent: HTMLElement): OverlayView {
  const panel = parent.ownerDocument.createElement("pre");
  panel.setAttribute("style", PANEL_STYLE);
  panel.hidden = true;
  parent.appendChild(panel);
  return {
    setVisible(visible) {
      panel.hidden = !visible;
    },
    setLines(lines) {
      panel.textContent = lines.join("\n");
    },
  };
}
