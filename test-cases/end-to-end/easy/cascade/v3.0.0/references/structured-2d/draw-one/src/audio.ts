// Cascade — audio, as engine cues (specs/audio.md).
//
// There is no Web Audio graph here, no mute flag of this build's own, and no
// autoplay unlock: the engine owns the context, the synthesis, the mute bit and
// the first-gesture unlock. The game's whole part is to DECLARE the ten cues
// `src/constants.ts` names, once, from the instance's `initialize`, and to play
// them by name on the world's cue bus as their events happen.
//
// A batch of resolved work — one controller tick, one mode tick, one debug
// operation — raises FLAGS rather than playing as it goes, and the batch is
// played at its end. That is what makes "each cue is played on the frame its
// event happens and at most once on that frame" true by construction: three
// cards turning home in one frame raise `home` once.
//
// The ten are pitched and shaped to be told apart by ear: a low riffle for the
// deal, a dry tick for a turn, a longer sweep for a recycle, a small rise as a
// card lifts and a small fall as it lands, a flat buzz when a drop is refused,
// a bright flick as a card turns face-up, a two-note chime as one goes home, a
// rising whoosh per launch, and a long fanfare for the win.

import type { CueSpec, InitApi, WorldAudio } from "@clockwyrks/structured-2d";
import { CUES, type CueName } from "./constants";
import type { CascadeState } from "./game";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.deal]: {
    wave: "sawtooth",
    freq: 190,
    freqTo: 90,
    gain: 0.14,
    durationMs: 180,
  },
  [CUES.turn]: {
    wave: "square",
    freq: 300,
    freqTo: 380,
    gain: 0.1,
    durationMs: 55,
  },
  [CUES.recycle]: {
    wave: "sawtooth",
    freq: 150,
    freqTo: 330,
    gain: 0.12,
    durationMs: 200,
  },
  [CUES.lift]: {
    wave: "sine",
    freq: 420,
    freqTo: 520,
    gain: 0.12,
    durationMs: 45,
  },
  [CUES.drop]: {
    wave: "sine",
    freq: 320,
    freqTo: 240,
    gain: 0.14,
    durationMs: 70,
  },
  [CUES.reject]: {
    wave: "square",
    freq: 180,
    freqTo: 120,
    gain: 0.1,
    durationMs: 120,
  },
  [CUES.flip]: {
    wave: "triangle",
    freq: 600,
    freqTo: 780,
    gain: 0.12,
    durationMs: 50,
  },
  [CUES.home]: {
    wave: "triangle",
    freq: 660,
    freqTo: 990,
    gain: 0.18,
    durationMs: 140,
  },
  [CUES.launch]: {
    wave: "sine",
    freq: 520,
    freqTo: 1040,
    gain: 0.1,
    durationMs: 70,
  },
  [CUES.win]: {
    wave: "triangle",
    freq: 392,
    freqTo: 1046,
    gain: 0.22,
    durationMs: 420,
  },
};

/** Declare every cue, once, before the start level opens. */
export function defineCues(api: Pick<InitApi, "audio">): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}

/**
 * What one batch of resolved work raised. Each cue flag plays its cue once;
 * `muteToggle` is the HUD's `SOUND` control asking the engine to flip its own
 * mute bit, which is the only way this game's state reaches the audio bus.
 */
export interface FrameCues extends Record<CueName, boolean> {
  muteToggle: boolean;
}

/** A batch that has raised nothing yet. */
export function noCues(): FrameCues {
  return {
    deal: false,
    turn: false,
    recycle: false,
    lift: false,
    drop: false,
    reject: false,
    flip: false,
    home: false,
    launch: false,
    win: false,
    muteToggle: false,
  };
}

/** Fold one batch into another, so a caller merges several resolutions into one. */
export function mergeCues(into: FrameCues, from: FrameCues): FrameCues {
  for (const key of Object.keys(into) as (keyof FrameCues)[]) {
    if (from[key]) into[key] = true;
  }
  return into;
}

/**
 * Play what a batch raised, and apply the mute toggle it asked for.
 *
 * The game's own copy of the mute bit is refreshed here as well as in the mode's
 * tick, so a `SOUND` press is reported by the snapshot the moment it is
 * answered rather than a frame later (specs/state.md, specs/screens.md).
 */
export function applyAudio(
  audio: WorldAudio,
  state: CascadeState,
  cues: FrameCues,
): void {
  if (cues.muteToggle) {
    audio.setMuted(!audio.muted());
    state.muted = audio.muted();
  }
  for (const cue of Object.keys(CUE_SPECS) as CueName[]) {
    if (cues[cue]) audio.play(cue);
  }
}
