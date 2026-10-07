// Volute — the one player controller (specs/controls.md).
//
// The engine reads the keyboard and the pointer, and a game reaches both only
// through a player controller, so this class is the whole of Volute's input.
// Controllers tick before any actor and before the game mode, so what is written
// here — the aim, a fired core, a swap, a screen change — is what the frame's
// simulation then runs from.
//
// The controller possesses nothing: the injector never moves, and there is no
// pawn to drive.

import { PlayerController } from "@clockwyrks/structured-2d";
import { AIM_TURN_RATE, INJECTOR_X, INJECTOR_Y } from "./constants";
import { HallMode } from "./hall-mode";
import { normalizeAngle } from "./math";

/** The action names, spelled once so a typo is a compile error. */
const ACTION = {
  aimLeft: "aim-left",
  aimRight: "aim-right",
  fire: "fire",
  swap: "swap",
  confirm: "confirm",
  pause: "pause",
  mute: "mute",
} as const;

/** The seat the injector is worked from. */
export class InjectorController extends PlayerController {
  override tick(dt: number): void {
    const mode = this.world.mode;
    if (!(mode instanceof HallMode)) return;
    const state = mode.state;

    // Mute answers on every screen (specs/controls.md).
    if (this.input.pressed(ACTION.mute)) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }

    switch (state.screen) {
      case "title":
      case "gameover":
      case "victory":
        // A primary pointer press anywhere on the field confirms here, so a run
        // starts and an ending dismisses without a keyboard.
        if (this.input.pressed(ACTION.confirm) || this.input.pointerPressed()) {
          mode.confirm();
        }
        break;
      case "paused":
        if (this.input.pressed(ACTION.pause)) state.screen = "playing";
        break;
      case "playing":
        this.readPlaying(mode, dt);
        break;
      case "cleared":
      case "setback":
        // Nothing; the interlude runs on its own timer.
        break;
    }
  }

  /**
   * The live hall: the pointer, the two turn actions, fire, swap, and pause.
   *
   * The pointer resolves first and the turn actions second, so a held turn
   * moves the aim on from wherever the pointer last put it.
   */
  private readPlaying(mode: HallMode, dt: number): void {
    // The primary pointer alone aims: a second finger on a touchscreen is not a
    // second aim.
    const samples = this.input
      .pointerSamples()
      .filter((sample) => sample.primary);
    const last = samples[samples.length - 1];
    if (last !== undefined) {
      const dx = last.x - INJECTOR_X;
      const dy = last.y - INJECTOR_Y;
      // A pointer exactly at the injector's center names no direction, so the
      // aim is left where it was.
      if (dx !== 0 || dy !== 0) {
        mode.aimAt(normalizeAngle((Math.atan2(dy, dx) * 180) / Math.PI));
      }
    }

    const turn =
      this.input.value(ACTION.aimRight) - this.input.value(ACTION.aimLeft);
    if (turn !== 0 && dt > 0) {
      mode.aimAt(mode.injector().aim + turn * AIM_TURN_RATE * dt);
    }

    if (this.input.pressed(ACTION.pause)) {
      mode.state.screen = "paused";
      return;
    }

    if (this.input.pressed(ACTION.swap)) mode.requestSwap();
    if (this.input.pressed(ACTION.fire) || this.input.pointerPressed()) {
      mode.requestFire();
    }
  }
}
