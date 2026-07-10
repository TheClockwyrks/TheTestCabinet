// Meltdown — input. Mouse-driven with keyboard accelerators (specs/controls.md).
// Client coordinates are mapped into the fixed 1280x720 logical space using the
// canvas's on-screen rect, so hit-testing is resolution independent. Held keys
// never auto-repeat an edge action: keydown is ignored while a key is held.

import { STAGE_H, STAGE_W } from "./constants";

export type InputEvent =
  | { kind: "click"; button: number; x: number; y: number }
  | { kind: "key"; code: string };

export class Input {
  mouseX = 0;
  mouseY = 0;
  private readonly held = new Set<string>();
  private readonly queue: InputEvent[] = [];
  private firstPress: (() => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  onFirstPress(cb: () => void): void {
    this.firstPress = cb;
  }

  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  attach(): void {
    this.canvas.addEventListener("mousemove", (e) => this.updateMouse(e));
    this.canvas.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.fireFirst();
      this.updateMouse(e);
      this.queue.push({ kind: "click", button: e.button, x: this.mouseX, y: this.mouseY });
    });
    // Right-click cancels placement; suppress the context menu over the canvas.
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => {
      if (e.repeat || this.held.has(e.code)) return;
      // Keep the browser from scrolling on Space / arrows during play.
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
        e.preventDefault();
      }
      this.held.add(e.code);
      this.fireFirst();
      this.queue.push({ kind: "key", code: e.code });
    });
    window.addEventListener("keyup", (e) => this.held.delete(e.code));
  }

  private fireFirst(): void {
    if (this.firstPress) {
      const cb = this.firstPress;
      this.firstPress = null;
      cb();
    }
  }

  private updateMouse(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const sx = STAGE_W / rect.width;
    const sy = STAGE_H / rect.height;
    this.mouseX = (e.clientX - rect.left) * sx;
    this.mouseY = (e.clientY - rect.top) * sy;
  }

  drain(): InputEvent[] {
    const out = this.queue.slice();
    this.queue.length = 0;
    return out;
  }
}
