// Coil — keyboard input (specs/flow.md "Controls"). Keyboard only.
//
// A tiny queue: keydown events are collected and drained once per frame by the loop, so
// input is handled at frame boundaries alongside the fixed-step simulation. Arrow keys,
// space, and the letter keys the game uses are prevent-defaulted so the page never scrolls
// or scrubs while playing.

const CONSUMED = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  " ",
  "Enter",
  "Escape",
  "w",
  "a",
  "s",
  "d",
  "p",
  "m",
  "W",
  "A",
  "S",
  "D",
  "P",
  "M",
]);

export class Input {
  private queue: string[] = [];

  attach(): void {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return; // steering and menu nav are per-press, not auto-repeat
      if (CONSUMED.has(e.key)) e.preventDefault();
      this.queue.push(e.key);
    });
  }

  drain(): string[] {
    if (this.queue.length === 0) return [];
    const out = this.queue;
    this.queue = [];
    return out;
  }
}
