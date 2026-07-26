// Valence — raw input (specs/controls.md). Mouse + keyboard only.
//
// Collects pointer position and queued clicks / keys in CLIENT pixels; the loop maps
// them into the fixed 1280x720 logical space with the current fit transform and
// routes them (see main.ts). Kept dumb on purpose — all interpretation is in the
// controller, which knows the frame's clickable regions and the game state.

export class Input {
  clientX = -1;
  clientY = -1;
  private scale = 1;
  private offX = 0;
  private offY = 0;

  clicks: { x: number; y: number }[] = [];
  rightClicks = 0;
  keys: string[] = [];

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
      const p = this.toLogical(e.clientX, e.clientY);
      this.clicks.push(p);
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => {
      // Keep the page from scrolling on Space / arrows while playing.
      if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
      this.keys.push(e.key);
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

  drain(): void {
    this.clicks.length = 0;
    this.rightClicks = 0;
    this.keys.length = 0;
  }
}
