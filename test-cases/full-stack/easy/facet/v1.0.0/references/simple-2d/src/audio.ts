// Facet — audio, as the engine's cues over the produced sounds.
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// engine owns the context, the decoding, the mute bit, and the first-gesture
// unlock. The game's whole part is to BIND each cue to the `.wav` the build
// produced, once, and then to PLAY it BY NAME as its event happens
// (specs/ui.md) — each on the frame its event happens and at most once on that
// frame, which `playFrameEvents` gets by playing from the frame's merged event
// flags rather than from each thing that raised one.
//
// Two of the nine cues are more than one file.
//
//   * `clear` sounds the CHAIN LADDER. `specs/assets.md` produces eight tones
//     ascending in pitch and a sampled shatter body "layered under the chain
//     ladder's tone so the `clear` cue lands with weight". The engine's bus
//     carries one source per cue name, so the `clear` cue itself is that
//     shatter body and the rung for the step's multiplier is played beside it
//     on the same frame. The rungs are that one cue's sources rather than
//     events of their own: nothing ever plays a rung except a clear, and step
//     `1` plays the lowest while a capped chain holds on the highest.
//
//   * The MUSIC is not a cue at all but a bed. The title theme loops on `title`
//     and `howto` and the play bed on `playing`, `paused`, `levelclear`, and
//     `gameover`, so one of the two is sounding on every screen. It is asked for by screen on
//     every frame; the engine's `loop` on a cue already looping does nothing, so
//     asking again costs nothing and the swap happens on the frame the screen
//     changes. The engine's mute bit silences the beds along with the cues.
//
// A CUE WHOSE FILE DID NOT ARRIVE is declared as a plain synthesized bleep
// instead, so `play` — which throws on a name that was never declared — cannot
// take a frame down. Every one of the nineteen files below is committed, so a
// build serving its own `dist/` never declares one; the fallback exists for the
// build standing up in process, where there is no page to fetch from.

import { CUES, MAX_MULTIPLIER } from "./constants";
import { LADDER_RUNGS } from "./assets";
import type { FacetState, Screen } from "./game";
import type { CueSpec, InitApi, UpdateApi } from "@clockwyrks/simple-2d";
import type { FacetEvents } from "./core";

/** The cue one rung of the chain ladder is played under, `1` the lowest. */
export function ladderCue(rung: number): string {
  return `chain-${rung}`;
}

/** The two music beds, which are looped rather than played. */
export const MUSIC_TITLE = "music-title";
export const MUSIC_PLAY = "music-play";

/**
 * Every cue name the build declares, and the produced file that sounds it.
 *
 * The nine `CUES` names are exactly the nine `specs/ui.md` fixes. `clear` is
 * bound to the sampled shatter body and the eight rungs sit beside it; the two
 * beds close the list.
 */
export function cueSources(): Readonly<Record<string, string>> {
  const sources: Record<string, string> = {
    [CUES.select]: "audio/select.wav",
    [CUES.swap]: "audio/swap.wav",
    [CUES.refuse]: "audio/refuse.wav",
    [CUES.clear]: "audio/shatter.wav",
    [CUES.land]: "audio/land.wav",
    [CUES.flaw]: "audio/flaw.wav",
    [CUES.cut]: "audio/cut.wav",
    [CUES.levelUp]: "audio/levelup.wav",
    [CUES.gameOver]: "audio/gameover.wav",
    [MUSIC_TITLE]: "audio/title.wav",
    [MUSIC_PLAY]: "audio/play.wav",
  };
  for (let rung = 1; rung <= LADDER_RUNGS; rung += 1) {
    sources[ladderCue(rung)] = `audio/chain-${rung}.wav`;
  }
  return sources;
}

/**
 * The bleep a cue falls back to when its produced file did not arrive. It is
 * never heard in a build serving its own committed assets; see the header.
 */
export function fallbackSpec(cue: string): CueSpec {
  if (cue === MUSIC_TITLE || cue === MUSIC_PLAY) {
    return { wave: "sine", freq: 220, gain: 0.05, durationMs: 400 };
  }
  return { wave: "triangle", freq: 440, gain: 0.1, durationMs: 90 };
}

/**
 * Bind every cue to its produced file, and declare a bleep under any name whose
 * file did not arrive, so every name below is playable by the first frame.
 * Returns the names that fell back, which a test reads and the game does not.
 */
export async function installCues(
  api: Pick<InitApi<FacetState>, "audio">,
): Promise<string[]> {
  const missing: string[] = [];
  await Promise.all(
    Object.entries(cueSources()).map(async ([cue, path]) => {
      try {
        await api.audio.load(cue, path);
      } catch {
        missing.push(cue);
      }
    }),
  );
  for (const cue of missing.sort()) api.audio.define(cue, fallbackSpec(cue));
  return missing;
}

/** The bed a screen plays under it. One of the two sounds on every screen. */
export function bedForScreen(screen: Screen): string {
  return screen === "title" || screen === "howto" ? MUSIC_TITLE : MUSIC_PLAY;
}

/** Loop the screen's bed and stop the other one, both idempotent. */
export function playBed(api: Pick<UpdateApi, "audio">, screen: Screen): void {
  const wanted = bedForScreen(screen);
  const other = wanted === MUSIC_TITLE ? MUSIC_PLAY : MUSIC_TITLE;
  if (api.audio.looping(other)) api.audio.stop(other);
  if (!api.audio.looping(wanted)) api.audio.loop(wanted);
}

/**
 * Play the cue for each event this frame raised, and ask for the screen's bed.
 *
 * A frame that raises more than one event plays each of those once; a frame
 * that raises none plays nothing but the bed it asks for. `rung` is the ladder
 * rung `clear` sounds, which is the multiplier of the step that cleared —
 * clamped here, so a capped chain holds on the top rung.
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
    api.audio.play(CUES.clear);
    api.audio.play(ladderCue(Math.min(Math.max(rung, 1), MAX_MULTIPLIER)));
  }
  if (events.land) api.audio.play(CUES.land);
  if (events.flaw) api.audio.play(CUES.flaw);
  if (events.cut) api.audio.play(CUES.cut);
  if (events.levelUp) api.audio.play(CUES.levelUp);
  if (events.gameOver) api.audio.play(CUES.gameOver);
  playBed(api, screen);
}
