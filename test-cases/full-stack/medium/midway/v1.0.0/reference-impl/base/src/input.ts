// Midway — raw input (specs/controls.md). Mouse + keyboard only.
//
// Collects the pointer position, queued button presses/releases, wheel notches, and key
// events in CLIENT pixels; the loop (main.ts) maps them into the fixed 1280x720 logical
// space with the current fit transform and routes them against the frame's clickable
// regions. This is valence's Input plus the two things the park view needs: a DRAG (the
// path tool lays a run between a press and its release) and a WHEEL (camera zoom). It also
// keeps a HELD-key set so the loop can pan the camera smoothly while keys are down.
//
// Kept deliberately dumb: it records what happened but interprets nothing — the controller
// knows the game state, the active tool, and what was drawn, so all meaning lives there.

export interface Point {
  x: number;
  y: number;
}

export class Input {
  clientX = -1;
  clientY = -1;
  private scale = 1;
  private offX = 0;
  private offY = 0;

  presses: Point[] = []; // left-button down events this frame (logical px)
  releases: Point[] = []; // left-button up events this frame (logical px)
  rightClicks = 0; // right-button down events (cancel the held build item)
  wheel = 0; // accumulated wheel deltaY this frame (positive = scroll down)
  keys: string[] = []; // discrete keydowns this frame (auto-repeat suppressed)
  held = new Set<string>(); // keys currently down, for continuous camera pan

  attach(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("mousemove", (e) => {
      this.clientX = e.clientX;
      this.clientY = e.clientY;
    });
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 2) {
        this.rightClicks++;
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      this.presses.push(this.toLogical(e.clientX, e.clientY));
    });
    // Release can land outside the canvas mid-drag, so listen on the window.
    window.addEventListener("mouseup", (e) => {
      if (e.button !== 0) return;
      this.releases.push(this.toLogical(e.clientX, e.clientY));
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault(); // keep the wheel zooming the park, not scrolling the page
        this.wheel += e.deltaY;
      },
      { passive: false },
    );
    window.addEventListener("keydown", (e) => {
      // Keep the page from scrolling on Space / arrows while playing.
      if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
      this.held.add(e.key);
      if (!e.repeat) this.keys.push(e.key); // one discrete action per physical press
    });
    window.addEventListener("keyup", (e) => {
      this.held.delete(e.key);
    });
    // Dropping focus must not leave a key "stuck" panning the camera.
    window.addEventListener("blur", () => this.held.clear());
  }

  setViewport(scale: number, offX: number, offY: number): void {
    this.scale = scale;
    this.offX = offX;
    this.offY = offY;
  }

  toLogical(clientX: number, clientY: number): Point {
    return { x: (clientX - this.offX) / this.scale, y: (clientY - this.offY) / this.scale };
  }

  get pointerLogical(): Point {
    return this.toLogical(this.clientX, this.clientY);
  }

  // True while any of the given keys are currently held (letter keys matched case-insensitively).
  heldAny(...keys: string[]): boolean {
    for (const k of keys) {
      if (this.held.has(k)) return true;
      if (k.length === 1 && (this.held.has(k.toLowerCase()) || this.held.has(k.toUpperCase()))) return true;
    }
    return false;
  }

  // Clear the per-frame queues (the held set persists across frames until keyup).
  drain(): void {
    this.presses.length = 0;
    this.releases.length = 0;
    this.rightClicks = 0;
    this.wheel = 0;
    this.keys.length = 0;
  }
}
