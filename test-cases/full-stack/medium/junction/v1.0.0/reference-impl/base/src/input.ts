// Junction — raw input capture (specs/controls.md). Mouse + keyboard only.
//
// Collects pointer position, edge-triggered mouse downs/ups, an accumulated wheel delta, and
// keyboard presses in CLIENT pixels; the loop (main.ts) maps them into the fixed 1280×720
// logical space with the current fit transform and interprets them against the frame's
// clickable regions and the game state. Kept deliberately dumb — it holds no game state and
// makes no gameplay decisions. Mirrors valence's `Input`, extended with a `held` key set (for
// continuous keyboard panning), discrete mouse down/up queues (for tool drags and drag-pan),
// and a wheel accumulator (for zoom).

export interface PointerEvt {
  x: number; // logical stage px
  y: number;
  button: number; // 0 = left, 1 = middle, 2 = right
}

// Normalise a key for the held set: single characters lower-cased (so "A" and "a" coincide),
// named keys (arrows, "Escape", …) left as-is.
function keyId(k: string): string {
  return k.length === 1 ? k.toLowerCase() : k;
}

export class Input {
  clientX = -1;
  clientY = -1;
  private scale = 1;
  private offX = 0;
  private offY = 0;

  downs: PointerEvt[] = [];
  ups: PointerEvt[] = [];
  wheel = 0; // accumulated wheel deltaY this frame (sign only is used)
  keys: string[] = []; // edge-triggered key presses (first press, not auto-repeat)
  held = new Set<string>(); // keys currently down (normalised), for continuous pan

  attach(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("mousemove", (e) => {
      this.clientX = e.clientX;
      this.clientY = e.clientY;
    });
    canvas.addEventListener("mousedown", (e) => {
      const p = this.toLogical(e.clientX, e.clientY);
      this.downs.push({ x: p.x, y: p.y, button: e.button });
    });
    // Listen for the release on the window so a drag that ends off the canvas still commits.
    window.addEventListener("mouseup", (e) => {
      const p = this.toLogical(e.clientX, e.clientY);
      this.ups.push({ x: p.x, y: p.y, button: e.button });
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault(); // keep the wheel from scrolling the page — it zooms the camera
        this.wheel += e.deltaY;
      },
      { passive: false },
    );
    window.addEventListener("keydown", (e) => {
      // Keep the page from scrolling / tab-cycling on the game keys while playing.
      if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.key)) e.preventDefault();
      const id = keyId(e.key);
      if (!this.held.has(id)) this.keys.push(e.key); // edge only — ignore OS auto-repeat
      this.held.add(id);
    });
    window.addEventListener("keyup", (e) => {
      this.held.delete(keyId(e.key));
    });
    // If the window loses focus mid-press, drop the held keys so pan does not stick on.
    window.addEventListener("blur", () => this.held.clear());
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

  // Clear the per-frame edge queues (the continuous `held` set persists across frames).
  clearEdges(): void {
    this.downs.length = 0;
    this.ups.length = 0;
    this.keys.length = 0;
    this.wheel = 0;
  }
}
