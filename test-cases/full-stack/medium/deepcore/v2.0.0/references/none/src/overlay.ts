// Deepcore — the read-only diagnostics overlay (specs/instrumentation.md).
//
// Part of the runtime layer rather than the game: the game registers the values it
// wants watched and this module draws them, plainly and clearly apart from the status
// bar. The backtick key shows and hides it and it starts hidden. Every source is a
// pure read, so watching the overlay leaves the game exactly as it is.

import { FONT_STACK, PALETTE } from "./constants";

/** One watched value: a short label and a function that reads it. */
interface Source {
  label: string;
  read: () => string;
}

export class Diagnostics {
  private sources: Source[] = [];
  /** Whether the panel is drawn. It starts hidden. */
  visible = false;

  /** Register a value to watch. The function is called at each read and nothing else. */
  register(label: string, read: () => string): void {
    this.sources.push({ label, read });
  }

  toggle(): void {
    this.visible = !this.visible;
  }

  /** Draw the panel over the running game, changing nothing. */
  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.visible || !this.sources.length) return;
    const lines = this.sources.map((s) => `${s.label.padEnd(9)} ${s.read()}`);

    const pad = 12;
    const lineH = 18;
    const x = 16;
    const y = 16;
    const w = 640;
    const h = pad * 2 + 20 + lines.length * lineH;

    ctx.save();
    ctx.fillStyle = "rgba(5, 7, 10, 0.82)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = PALETTE.coreGlow;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = PALETTE.coreGlow;
    ctx.font = `700 12px ${FONT_STACK}`;
    ctx.fillText("DIAGNOSTICS", x + pad, y + pad);

    ctx.fillStyle = "#b7c2d0";
    ctx.font = `14px ${FONT_STACK}`;
    let ly = y + pad + 20;
    for (const line of lines) {
      ctx.fillText(line, x + pad, ly);
      ly += lineH;
    }
    ctx.restore();
  }
}
