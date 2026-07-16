// Deepcore — raw input (specs/controls.md). Mouse + keyboard only.
//
// Movement/drilling is HELD (a direction key held keeps moving/drilling), so the loop
// reads the live held-key set each fixed step; menu/system actions (activate, pause,
// mute, confirm, navigate) are edge events drained each frame. Pointer position and
// clicks are collected in client pixels and mapped into the fixed 1280×720 logical space
// by the loop (see main.ts). This module stays dumb; the controller interprets it.

export interface HeldKeys {
  left: boolean;
  right: boolean;
  down: boolean;
  thrust: boolean;
}

const LEFT = new Set(["a", "arrowleft"]);
const RIGHT = new Set(["d", "arrowright"]);
const DOWN = new Set(["s", "arrowdown"]);
const THRUST = new Set(["w", "arrowup", " "]);

export class Input {
  clientX = -1;
  clientY = -1;
  private scale = 1;
  private offX = 0;
  private offY = 0;

  private down = new Set<string>();
  keys: string[] = []; // edge key presses (menus / activate / pause / mute)
  clicks: { x: number; y: number }[] = [];

  attach(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("mousemove", (e) => {
      this.clientX = e.clientX;
      this.clientY = e.clientY;
    });
    canvas.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      this.clicks.push(this.toLogical(e.clientX, e.clientY));
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => {
      if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
      const k = e.key.toLowerCase();
      if (!e.repeat) this.keys.push(e.key);
      this.down.add(k);
    });
    window.addEventListener("keyup", (e) => {
      this.down.delete(e.key.toLowerCase());
    });
    // Held keys must not stick when focus is lost.
    window.addEventListener("blur", () => this.down.clear());
  }

  setViewport(scale: number, offX: number, offY: number): void {
    this.scale = scale;
    this.offX = offX;
    this.offY = offY;
  }

  toLogical(clientX: number, clientY: number): { x: number; y: number } {
    return { x: (clientX - this.offX) / this.scale, y: (clientY - this.offY) / this.scale };
  }

  get pointerLogical(): { x: number; y: number } {
    return this.toLogical(this.clientX, this.clientY);
  }

  held(): HeldKeys {
    const has = (set: Set<string>): boolean => {
      for (const k of set) if (this.down.has(k)) return true;
      return false;
    };
    return { left: has(LEFT), right: has(RIGHT), down: has(DOWN), thrust: has(THRUST) };
  }

  drain(): void {
    this.keys.length = 0;
    this.clicks.length = 0;
  }
}
