// Keyboard (required) and optional mouse input (specs/controls.md). Movement uses
// held state (smooth/continuous); menus and system keys use a once-per-frame
// edge queue. The keyboard scheme fully plays the game; the mouse is additive.

import { STAGE_W, STAGE_H } from "./constants";

export class Input {
  private held = new Set<string>();
  private queue: string[] = []; // edge-pressed action keys, drained per frame

  // Mouse state (optional). Position is in logical stage coordinates.
  mouseX = STAGE_W / 2;
  mouseY = STAGE_H / 2;
  mouseActive = false;
  mouseFire = false; // held left button
  private clickQueue = 0; // fresh clicks (for menu confirm)

  private canvas: HTMLCanvasElement | null = null;

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // Prevent the page from scrolling on the keys the game uses.
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        " ",
        "Spacebar",
      ].includes(e.key)
    ) {
      e.preventDefault();
    }
    if (!e.repeat) this.queue.push(k);
    this.held.add(k);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    this.held.delete(k);
  };

  private onBlur = (): void => {
    this.held.clear();
    this.mouseFire = false;
  };

  private toLogical(e: MouseEvent): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.mouseX = ((e.clientX - rect.left) / rect.width) * STAGE_W;
    this.mouseY = ((e.clientY - rect.top) / rect.height) * STAGE_H;
    this.mouseActive = true;
  }

  private onMouseMove = (e: MouseEvent): void => {
    this.toLogical(e);
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    this.toLogical(e);
    this.mouseFire = true;
    this.clickQueue++;
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    this.mouseFire = false;
  };

  // --- Held (continuous) queries ---
  down(...keys: string[]): boolean {
    return keys.some((k) => this.held.has(k));
  }

  get left(): boolean {
    return this.down("ArrowLeft", "a");
  }
  get right(): boolean {
    return this.down("ArrowRight", "d");
  }
  get up(): boolean {
    return this.down("ArrowUp", "w");
  }
  get down_(): boolean {
    return this.down("ArrowDown", "s");
  }
  get firing(): boolean {
    return this.held.has(" ") || this.held.has("Spacebar") || this.mouseFire;
  }

  // --- Edge (once-per-frame) queries ---
  // Returns and clears the queue of edge-pressed keys for this frame.
  drainKeys(): string[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  drainClicks(): number {
    const c = this.clickQueue;
    this.clickQueue = 0;
    return c;
  }
}
