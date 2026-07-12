// Hollowdeep — raw input capture (specs/controls.md). Mouse + keyboard only.
//
// Collects the pointer position, discrete left-button CLICKS, the left-button DRAG gesture
// (the dig rectangle / build paint), a middle-or-right-button PAN drag, mouse-WHEEL zoom,
// queued key presses, and the set of currently-HELD keys (for smooth camera panning) — all
// in CLIENT pixels. The loop (src/main.ts) maps them into the fixed 1280x720 logical space
// with the live fit transform and interprets them against the frame's clickable regions and
// the game state. Kept deliberately dumb: no game knowledge lives here (mirrors valence's
// input.ts, extended with the dig-drag rectangle, mouse pan, and wheel zoom).

// Client px the pointer must travel after a left press before it counts as a drag (so a
// small wobble on a click still reads as a click, not a one-tile dig rectangle).
const DRAG_THRESHOLD = 5;

export interface DragRect {
  x0: number; // logical stage coords (the fixed 1280x720 space)
  y0: number;
  x1: number;
  y1: number;
}

export class Input {
  clientX = -1;
  clientY = -1;
  private scale = 1;
  private offX = 0;
  private offY = 0;

  // ---- per-frame queues (drained by the loop after it consumes them) ----
  clicks: { x: number; y: number }[] = []; // left presses that ended WITHOUT a drag (logical)
  dragEnds: DragRect[] = []; // left drags that completed this frame (logical)
  keys: string[] = []; // keydown events — discrete actions / menu nav
  panDX = 0; // client-px pan movement this frame (middle/right-button drag)
  panDY = 0;
  wheel = 0; // accumulated wheel deltaY this frame (down = zoom out)

  // ---- live state (NOT drained) ----
  held = new Set<string>(); // currently-held keys (lowercased) — camera pan
  dragging: DragRect | null = null; // the in-progress left drag (logical), or null

  // internal left-press bookkeeping (client px)
  private downX = 0;
  private downY = 0;
  private leftDown = false;
  private didDrag = false;
  // internal pan bookkeeping (client px)
  private panning = false;
  private panLastX = 0;
  private panLastY = 0;

  attach(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("mousemove", (e) => {
      this.clientX = e.clientX;
      this.clientY = e.clientY;
      if (this.leftDown) {
        if (!this.didDrag && Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > DRAG_THRESHOLD) {
          this.didDrag = true;
        }
        if (this.didDrag) {
          const a = this.toLogical(this.downX, this.downY);
          const b = this.toLogical(e.clientX, e.clientY);
          this.dragging = { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
        }
      }
      if (this.panning) {
        this.panDX += e.clientX - this.panLastX;
        this.panDY += e.clientY - this.panLastY;
        this.panLastX = e.clientX;
        this.panLastY = e.clientY;
      }
    });

    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 0) {
        this.leftDown = true;
        this.didDrag = false;
        this.downX = e.clientX;
        this.downY = e.clientY;
      } else if (e.button === 1 || e.button === 2) {
        // Middle / right button grabs the camera for a pan drag.
        this.panning = true;
        this.panLastX = e.clientX;
        this.panLastY = e.clientY;
        e.preventDefault();
      }
    });

    // Release on the window so a drag that ends off the canvas still resolves.
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0 && this.leftDown) {
        if (this.didDrag && this.dragging) this.dragEnds.push({ ...this.dragging });
        else this.clicks.push(this.toLogical(e.clientX, e.clientY));
        this.leftDown = false;
        this.didDrag = false;
        this.dragging = null;
      } else if ((e.button === 1 || e.button === 2) && this.panning) {
        this.panning = false;
      }
    });

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    canvas.addEventListener(
      "wheel",
      (e) => {
        this.wheel += e.deltaY;
        e.preventDefault();
      },
      { passive: false },
    );

    window.addEventListener("keydown", (e) => {
      // Keep the page from scrolling on Space / arrows while playing.
      if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
      this.keys.push(e.key);
      this.held.add(e.key.toLowerCase());
    });
    window.addEventListener("keyup", (e) => {
      this.held.delete(e.key.toLowerCase());
    });
    // Losing focus drops every held key / in-progress gesture so nothing sticks.
    window.addEventListener("blur", () => {
      this.held.clear();
      this.leftDown = false;
      this.didDrag = false;
      this.dragging = null;
      this.panning = false;
    });
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

  // The held-key pan direction (each axis -1 / 0 / +1) from the arrow keys or WASD, for the
  // loop's continuous camera pan (specs/controls.md — at least one keyboard pan).
  panAxis(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.held.has("arrowleft") || this.held.has("a")) x -= 1;
    if (this.held.has("arrowright") || this.held.has("d")) x += 1;
    if (this.held.has("arrowup") || this.held.has("w")) y -= 1;
    if (this.held.has("arrowdown") || this.held.has("s")) y += 1;
    return { x, y };
  }

  // Clear the per-frame queues (the live `held` set and `dragging` persist across frames).
  drain(): void {
    this.clicks.length = 0;
    this.dragEnds.length = 0;
    this.keys.length = 0;
    this.panDX = 0;
    this.panDY = 0;
    this.wheel = 0;
  }
}
