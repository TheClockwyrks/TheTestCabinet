// What the game's own systems ask of the engine.
//
// The rules are decided from the state and the site alone, but a few of them
// are audible: an edit clacks, a run starts with a signal, a tick creaks or
// snaps, and the drive hums while an axis turns. The engine owns the cue bus and
// the mute bit, so the systems reach both through this one narrow seam, which is
// what lets them be driven in a test with no engine standing up.

import type { World } from "@test-cabinet/structured-3d";
import type { CueName } from "./constants";

/** The cue the music bed plays under, beside the eleven `CUES` fix. */
export const MUSIC_CUE = "music";

/** The sound and the mute bit, as the game's systems reach them. */
export interface GameIo {
  /** Play a one-shot cue (`specs/ui.md`). */
  playCue(cue: CueName): void;
  /** Start or stop the one loop, `motor`, from what the run is doing. */
  setMotor(on: boolean): void;
  /** Start or stop the music bed the title and select screens carry. */
  setMusic(on: boolean): void;
  /** Toggle all sound, which the mode's tick mirrors into `state.muted`. */
  toggleMute(): void;
  /** The engine's mute bit, which the state carries a readable copy of. */
  muted(): boolean;
}

/**
 * The io over a world's cue bus. The world is read at each call rather than
 * held, so one of these outlives any particular world.
 */
export function worldIo(world: () => World): GameIo {
  return {
    playCue(cue) {
      world().audio.play(cue);
    },
    setMotor(on) {
      const audio = world().audio;
      if (on) audio.loop("motor");
      else audio.stop("motor");
    },
    setMusic(on) {
      const audio = world().audio;
      if (on) audio.loop(MUSIC_CUE);
      else audio.stop(MUSIC_CUE);
    },
    toggleMute() {
      const audio = world().audio;
      audio.setMuted(!audio.muted());
    },
    muted() {
      return world().audio.muted();
    },
  };
}

/** An io that sounds nothing, for a test and for a frame with no world yet. */
export function silentIo(): GameIo {
  let muted = false;
  return {
    playCue() {},
    setMotor() {},
    setMusic() {},
    toggleMute() {
      muted = !muted;
    },
    muted() {
      return muted;
    },
  };
}
