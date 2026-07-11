// Shatter — keyboard input.
//
// Two flavors of input are needed: held state (for continuous flight — turning,
// thrusting, firing — read live inside the physics step) and edge events (a
// keydown consumed once per frame for menu navigation and pause toggles).

const GAME_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyW",
  "KeyS",
  "KeyA",
  "KeyD",
  "Enter",
  "Space",
  "Escape",
  "KeyP",
  "KeyM",
  "KeyF",
]);

export class Input {
  private down = new Set<string>();
  private queue: string[] = [];
  private firstPressHandlers: Array<() => void> = [];
  private firstPressFired = false;

  attach(target: Window = window): void {
    target.addEventListener("keydown", this.onKeyDown);
    target.addEventListener("keyup", this.onKeyUp);
    // A lost focus (alt-tab) must not leave keys stuck "down".
    target.addEventListener("blur", this.onBlur);
  }

  // Register a callback fired on the very first key press — used to resume the
  // AudioContext, which browsers block until a user gesture.
  onFirstPress(fn: () => void): void {
    this.firstPressHandlers.push(fn);
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  // Drain and return the edge events queued since the last frame.
  drain(): string[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!this.firstPressFired) {
      this.firstPressFired = true;
      for (const fn of this.firstPressHandlers) fn();
    }
    if (e.repeat) return; // auto-repeat is held state, never an edge event
    this.down.add(e.code);
    this.queue.push(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private onBlur = (): void => {
    this.down.clear();
  };
}

// Semantic helpers over raw key codes — held flight controls.
export const KEY = {
  left: (i: Input): boolean => i.isDown("ArrowLeft") || i.isDown("KeyA"),
  right: (i: Input): boolean => i.isDown("ArrowRight") || i.isDown("KeyD"),
  thrust: (i: Input): boolean => i.isDown("ArrowUp") || i.isDown("KeyW"),
  fire: (i: Input): boolean => i.isDown("Space"),
  torpedo: (i: Input): boolean => i.isDown("KeyF"),
};

// Edge-event predicates — menu navigation and pause.
export function isMenuUp(code: string): boolean {
  return code === "ArrowUp" || code === "KeyW";
}
export function isMenuDown(code: string): boolean {
  return code === "ArrowDown" || code === "KeyS";
}
export function isConfirm(code: string): boolean {
  return code === "Enter" || code === "Space";
}
export function isBack(code: string): boolean {
  return code === "Escape";
}
export function isPause(code: string): boolean {
  return code === "Escape" || code === "KeyP";
}
