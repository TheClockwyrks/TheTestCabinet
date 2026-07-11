// Keyboard input (specs/controls.md). Movement uses held state
// (smooth/continuous); menus and system keys use a once-per-frame edge queue.
// The keyboard scheme fully plays the game.

export class Input {
  private held = new Set<string>();
  private queue: string[] = []; // edge-pressed action keys, drained per frame

  attach(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
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
    return this.held.has(" ") || this.held.has("Spacebar");
  }

  // --- Edge (once-per-frame) queries ---
  // Returns and clears the queue of edge-pressed keys for this frame.
  drainKeys(): string[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }
}
