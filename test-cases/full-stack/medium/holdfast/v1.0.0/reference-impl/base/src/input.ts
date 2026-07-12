// Holdfast — raw input (specs/controls.md). Keyboard + mouse only, no touch/gamepad.
//
// This layer stays deliberately dumb: it collects the frame's pointer position, the
// low-level press / release / right-click / wheel events, the discrete key presses, and
// the set of currently-held keys — all in CLIENT pixels, converted to the fixed 1280×720
// logical space with the live fit transform (setViewport, pushed each frame by main.ts).
// ALL interpretation — which clickable was hit, whether a press starts a designate drag,
// how held keys pan the camera — lives in main.ts, which knows the frame's clickable
// regions and the game state. Presses/releases are queued (drained each frame); held keys
// and the pointer persist across frames so main.ts can pan smoothly while a key is down.

export interface PointerPoint {
  x: number;
  y: number;
}

export class Input {
  // Live client-pixel pointer (updated on every mousemove) and the fit transform.
  clientX = -1;
  clientY = -1;
  private scale = 1;
  private offX = 0;
  private offY = 0;

  // Per-frame queues (logical coords), drained by main.ts each frame.
  downs: PointerPoint[] = []; // left-button press positions
  ups: PointerPoint[] = []; // left-button release positions
  rightClicks = 0; // right-button presses this frame
  keys: string[] = []; // discrete keydown events (menu nav, hotkeys) — original key strings
  wheel = 0; // accumulated wheel steps this frame (+ = zoom in, − = zoom out)

  // Persistent state (NOT drained): held keys (for camera pan) and whether the left
  // button is currently down (for edge cases / live drag).
  held = new Set<string>(); // lower-cased key names currently held
  pointerDown = false;

  attach(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("mousemove", (e) => {
      this.clientX = e.clientX;
      this.clientY = e.clientY;
    });
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 2) {
        this.rightClicks++;
        return;
      }
      if (e.button !== 0) return;
      this.pointerDown = true;
      this.downs.push(this.toLogical(e.clientX, e.clientY));
    });
    // Release can land off the canvas after a drag, so listen on the window.
    window.addEventListener("mouseup", (e) => {
      if (e.button !== 0 || !this.pointerDown) return;
      this.pointerDown = false;
      this.ups.push(this.toLogical(e.clientX, e.clientY));
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        // One step per notch; sign only (zoom is a small discrete ladder, specs/controls.md).
        this.wheel += e.deltaY < 0 ? 1 : -1;
      },
      { passive: false },
    );
    window.addEventListener("keydown", (e) => {
      // Keep the page from scrolling on Space / arrows while playing.
      if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
      if (!e.repeat) this.keys.push(e.key);
      this.held.add(e.key.toLowerCase());
    });
    window.addEventListener("keyup", (e) => {
      this.held.delete(e.key.toLowerCase());
    });
    // Never leave a key stuck held when focus leaves the window mid-press.
    window.addEventListener("blur", () => {
      this.held.clear();
      this.pointerDown = false;
    });
  }

  setViewport(scale: number, offX: number, offY: number): void {
    this.scale = scale;
    this.offX = offX;
    this.offY = offY;
  }

  toLogical(clientX: number, clientY: number): PointerPoint {
    return { x: (clientX - this.offX) / this.scale, y: (clientY - this.offY) / this.scale };
  }

  get pointerLogical(): PointerPoint {
    return this.toLogical(this.clientX, this.clientY);
  }

  // True while any of the given (lower-cased) keys is held — used for camera pan.
  anyHeld(keys: string[]): boolean {
    for (const k of keys) if (this.held.has(k)) return true;
    return false;
  }

  // Clear the per-frame queues (held keys and pointer position persist).
  drain(): void {
    this.downs.length = 0;
    this.ups.length = 0;
    this.rightClicks = 0;
    this.keys.length = 0;
    this.wheel = 0;
  }
}
