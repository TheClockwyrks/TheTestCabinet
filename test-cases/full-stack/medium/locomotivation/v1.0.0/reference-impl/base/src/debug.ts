// Locomotivation — the debugging and automation API installed on window.__loco.
//
// A thin surface over the exact game the UI drives: it advances the real fixed-timestep
// simulation (game.fixedStep) and reads the real state (game.debugSnapshot), so a scenario
// driven from code behaves identically to one played by hand. The control operations only
// set up situations and step the real systems forward; they never fabricate an outcome.
// Injected keyboard input flows through the very same handling the real keyboard feeds. See
// specs/instrumentation.md.

import { DT } from "./constants";
import type { Game, LocoSnapshot } from "./game";
import type {
  FreightColor,
  LastTrainCar,
  Orientation,
  PackageArchetype,
  TrainDir,
  TrainKind,
  WeightClass,
} from "./types";
import type { Facing } from "./sim/world";

interface WorkerPose {
  col?: number;
  row?: number;
  x?: number;
  y?: number;
  facing?: Facing;
}

interface PackageSpec {
  color: FreightColor;
  weightClass: WeightClass;
  archetype?: PackageArchetype;
}

interface GroundPackageSpec extends PackageSpec {
  col: number;
  row: number;
}

interface TrainSpec {
  line: number;
  orientation: Orientation;
  dir: TrainDir;
  kind: TrainKind;
  headPos?: number;
  isLast?: boolean;
  consist?: LastTrainCar[];
}

export interface LocoDebugApi {
  version: number;
  reset(options?: { seed?: number }): void;
  /** Advance the simulation by exactly this many whole fixed steps (ticks). */
  step(ticks: number): void;
  snapshot(): LocoSnapshot;
  startLevel(n: number): void;
  setWorker(state: WorkerPose): void;
  setClock(seconds: number): void;
  setLives(n: number): void;
  setDelivered(color: FreightColor, count: number): void;
  markUnique(id: string, delivered: boolean): void;
  givePackage(spec: PackageSpec): void;
  clearCarried(): void;
  spawnGroundPackage(spec: GroundPackageSpec): void;
  spawnTrain(spec: TrainSpec): void;
  forceLastTrain(): void;
  setAutoStep(enabled: boolean): void;
  keyDown(code: string): void;
  keyUp(code: string): void;
  press(code: string): void;
}

// Standard KeyboardEvent.code → the matching `key` value the game's input layer reads
// (it normalizes e.key to lower-case). Providing both keeps injected input on the exact
// same path as a real keypress.
const CODE_TO_KEY: Record<string, string> = {
  KeyW: "w",
  KeyA: "a",
  KeyS: "s",
  KeyD: "d",
  KeyE: "e",
  KeyQ: "q",
  KeyM: "m",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  ShiftLeft: "Shift",
  ShiftRight: "Shift",
  Space: " ",
  Escape: "Escape",
  Enter: "Enter",
};

function keyForCode(code: string): string {
  return CODE_TO_KEY[code] ?? code;
}

export function installDebugApi(game: Game): void {
  const api: LocoDebugApi = {
    version: 1,

    reset(options) {
      game.debugReset(options?.seed);
    },

    // Advance the real simulation by exactly `ticks` fixed steps, without waiting on real
    // time. The unit is whole simulation ticks (1 tick = DT = 1/60 s), not seconds, so
    // there is nothing to round: the caller asks for a number of steps and gets exactly
    // that many. A fractional or negative count is a caller mistake to surface rather than
    // to guess at.
    //
    // Stepping switches the game to the manual clock first, so no stray wall-clock frame
    // can pollute the measurement.
    step(ticks) {
      if (!Number.isInteger(ticks) || ticks < 0) {
        throw new Error(
          `__loco.step(ticks): expected a non-negative whole number of simulation ticks (1 tick = 1/60 s), received ${String(ticks)}`,
        );
      }
      game.setAutoStep(false);
      for (let i = 0; i < ticks; i++) game.fixedStep(DT);
    },

    snapshot() {
      return game.debugSnapshot();
    },

    startLevel(n) {
      game.debugStartLevel(n);
    },

    setWorker(state) {
      game.debugSetWorker(state ?? {});
    },

    setClock(seconds) {
      game.debugSetClock(seconds);
    },

    setLives(n) {
      game.debugSetLives(n);
    },

    setDelivered(color, count) {
      game.debugSetDelivered(color, count);
    },

    markUnique(id, delivered) {
      game.debugMarkUnique(id, Boolean(delivered));
    },

    givePackage(spec) {
      game.debugGivePackage(spec);
    },

    clearCarried() {
      game.debugClearCarried();
    },

    spawnGroundPackage(spec) {
      game.debugSpawnGroundPackage(spec);
    },

    spawnTrain(spec) {
      game.debugSpawnTrain(spec);
    },

    forceLastTrain() {
      game.debugForceLastTrain();
    },

    // Run the game live again (true) or return to manual stepping (false). A reset()
    // re-arms manual. See the manual-clock model in specs/instrumentation.md.
    setAutoStep(enabled) {
      game.setAutoStep(Boolean(enabled));
    },

    // Inject keyboard input through the same path the real keyboard feeds (a dispatched
    // KeyboardEvent the Input listener catches), so held movement and one-shot actions
    // behave exactly as a player's keypress would. A held movement key drives the worker
    // through the game's own step, so this confirms the controls themselves work.
    keyDown(code) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code, key: keyForCode(code) }));
      // Apply any one-shot menu action at once, so a caller need not wait for a render frame.
      game.pumpInput();
    },

    keyUp(code) {
      window.dispatchEvent(new KeyboardEvent("keyup", { code, key: keyForCode(code) }));
    },

    press(code) {
      this.keyDown(code);
      this.keyUp(code);
    },
  };

  (window as unknown as { __loco?: LocoDebugApi }).__loco = api;

  // The read-only debug overlay is toggled by the backtick key. It only draws; it never
  // affects gameplay, and it is off by default (specs/instrumentation.md).
  window.addEventListener("keydown", (e) => {
    if (e.key === "`" || e.code === "Backquote") game.toggleDebugOverlay();
  });
}
