// Facet — audio, as the runtime's cues over the produced sounds.
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// runtime's audio bus owns the context, the decoding, the mute state, and the
// first-gesture unlock (src/audio-bus.ts). The game's whole part is to DECLARE
// the eight cues `CUES` names, once, over the `.wav` files the build produced,
// and then to play them BY NAME as the events happen (specs/ui.md) — each on
// the frame its event happens and at most once on that frame, which
// `playFrameEvents` enforces by playing from the frame's merged event flags
// rather than from each thing that raised one.
//
// Two cues are more than one file.
//
//   * `clear` sounds the CHAIN LADDER: the rung for the step's multiplier,
//     `chain-1` at the bottom and `chain-8` at the top, with the sampled
//     shatter body under it so the clear lands with weight. The rungs are that
//     one cue's sources rather than events of their own, so the bus picks one
//     by the variant the play names.
//   * The music is not a cue at all but a bed: the title theme under `title`
//     and `howto`, the play bed under `playing`, `paused`, and `gameover`, so
//     one of the two is sounding on every screen. It is asked for by screen on
//     every frame, and the bus starts, swaps, or leaves it alone.

import { CUES, MAX_MULTIPLIER } from "./constants";
import { LADDER_RUNGS, MUSIC_PLAY, MUSIC_TITLE, ladderKey } from "./assets";
import type { CueSpec } from "./audio-bus";
import type { InitApi, UpdateApi } from "./runtime";
import type { FacetEvents, FacetState, Screen } from "./core";

/** The chain ladder's eight rungs, lowest first. */
const LADDER = Array.from({ length: LADDER_RUNGS }, (_, index) =>
  ladderKey(index + 1),
);

/**
 * The eight cues, each over the produced files that sound it.
 *
 * The gains are the mix: the ladder and the level-up carry the moments a
 * player is meant to feel, `select` and `swap` sit under them so a fast hand
 * is not louder than the board, and `refuse` is flat and brief.
 */
export const CUE_SPECS: Readonly<Record<string, CueSpec>> = {
  [CUES.select]: { layers: ["select"], gain: 0.4 },
  [CUES.swap]: { layers: ["swap"], gain: 0.45 },
  [CUES.refuse]: { layers: ["refuse"], gain: 0.5 },
  [CUES.clear]: { layers: ["shatter"], ladder: LADDER, gain: 0.75 },
  [CUES.flaw]: { layers: ["flaw"], gain: 0.5 },
  [CUES.cut]: { layers: ["cut"], gain: 0.55 },
  [CUES.levelUp]: { layers: ["levelup"], gain: 0.7 },
  [CUES.gameOver]: { layers: ["gameover"], gain: 0.7 },
};

/** Declare every cue, once, before the first frame. */
export function defineCues(api: Pick<InitApi<FacetState>, "audio">): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}

/** The bed a screen plays under it. One of the two sounds on every screen. */
export function trackForScreen(screen: Screen): string {
  return screen === "title" || screen === "howto" ? MUSIC_TITLE : MUSIC_PLAY;
}

/**
 * Play the cue for each event this frame raised, and ask for the screen's bed.
 *
 * A frame that raises more than one event plays each of those once; a frame
 * that raises none plays nothing. `rung` is the ladder rung `clear` sounds,
 * which is the multiplier of the step that cleared — clamped by the bus, so a
 * capped chain holds on the top rung.
 */
export function playFrameEvents(
  api: Pick<UpdateApi, "audio">,
  events: FacetEvents,
  rung: number,
  screen: Screen,
): void {
  if (events.select) api.audio.play(CUES.select);
  if (events.swap) api.audio.play(CUES.swap);
  if (events.refuse) api.audio.play(CUES.refuse);
  if (events.clear) {
    api.audio.play(CUES.clear, Math.min(Math.max(rung, 1), MAX_MULTIPLIER));
  }
  if (events.flaw) api.audio.play(CUES.flaw);
  if (events.cut) api.audio.play(CUES.cut);
  if (events.levelUp) api.audio.play(CUES.levelUp);
  if (events.gameOver) api.audio.play(CUES.gameOver);
  api.audio.setTrack(trackForScreen(screen));
}
