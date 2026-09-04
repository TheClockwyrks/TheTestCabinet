// Facet — audio, as the engine's cues over the produced sounds.
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// engine owns the context, the decoding, the mute state, and the first-gesture
// unlock (engine/audio.md). The game's whole part is to DECLARE its cues once,
// from the game instance's `initialize`, over the `.wav` files this build
// produced, and then to play them BY NAME as the events happen (specs/ui.md) —
// each on the frame its event happens and at most once on that frame, which
// `playFrameEvents` upholds by playing from the frame's MERGED event flags
// rather than from each thing that raised one.
//
// EVERY CUE IS DECLARED TWICE, and the order matters. `defineCues` declares a
// synthesized placeholder for every name, synchronously, so the name exists
// from the first frame; `loadCues` then binds the produced `.wav` over it,
// which the engine documents as replacing what the name plays. What a player
// hears is therefore always the produced sound. The placeholder is what keeps a
// missing file from turning `world.audio.play` — which throws on an undeclared
// name — into a crash, exactly as the fallback in `src/render.gems.ts` keeps a
// missing sprite from leaving a hole.
//
// TWO CUES SOUND ONE EVENT. `specs/assets.md` lays the sampled shatter body
// under the chain ladder's tone so the `clear` cue lands with weight, and
// `specs/ui.md` calls the eight rungs "that one cue's sources rather than
// events of their own". An engine cue name carries exactly one source
// (engine/audio.md), so the layering is done by playing two names on the one
// event: `CUES.clear` carries the body, and the rung for the step's multiplier
// carries the tone. The event is still one event, played once per frame; only
// the mixing moved from the file into the bus.
//
// The music is not a cue at all but a bed: the title theme under `title` and
// `howto`, the play bed under `playing`, `paused`, `levelclear`, and
// `gameover`, so one of the two is sounding on every screen. It is asked for by
// screen on every frame, and the engine's `loop`/`stop` are no-ops on a cue
// already in that state, which is the shape engine/audio.md asks a loop to be
// driven in.

import type { CueSpec, InitApi, WorldAudio } from "@test-cabinet/structured-2d";
import { CUES, MAX_MULTIPLIER } from "./constants";
import { LADDER_RUNGS } from "./assets";
import type { FacetEvents } from "./core";
import type { Screen } from "./game";

/** The cue name one rung of the chain ladder is played under. */
export function ladderCue(rung: number): string {
  const clamped = Math.min(Math.max(Math.round(rung), 1), LADDER_RUNGS);
  return `chain-${clamped}`;
}

/** The two looping beds. One of them sounds on every screen. */
export const MUSIC_TITLE = "music-title";
export const MUSIC_PLAY = "music-play";

/**
 * Every cue name this build declares, each against the produced file that
 * sounds it, as a path below the engine's asset root (specs/assets.md).
 */
export function cueFiles(): Readonly<Record<string, string>> {
  const files: Record<string, string> = {
    [CUES.select]: "audio/select.wav",
    [CUES.swap]: "audio/swap.wav",
    [CUES.refuse]: "audio/refuse.wav",
    // The sampled shatter body; the ladder rung is played over it.
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
    files[ladderCue(rung)] = `audio/chain-${rung}.wav`;
  }
  return files;
}

/**
 * The placeholder each name is declared with before its file lands: a short
 * synthesized shape of roughly the right character, so a build whose sound
 * never arrived is audibly wrong rather than silently absent. The ladder's
 * eight rungs ascend a scale, as the produced ladder does.
 */
export function cueSpecs(): Readonly<Record<string, CueSpec>> {
  const specs: Record<string, CueSpec> = {
    [CUES.select]: { wave: "sine", freq: 660, gain: 0.14, durationMs: 50 },
    [CUES.swap]: { wave: "triangle", freq: 440, gain: 0.16, durationMs: 70 },
    [CUES.refuse]: { wave: "square", freq: 150, gain: 0.14, durationMs: 90 },
    [CUES.clear]: {
      wave: "sawtooth",
      freq: 220,
      freqTo: 110,
      gain: 0.18,
      durationMs: 140,
    },
    [CUES.land]: {
      wave: "sine",
      freq: 140,
      freqTo: 70,
      gain: 0.2,
      durationMs: 180,
    },
    [CUES.flaw]: { wave: "square", freq: 320, gain: 0.16, durationMs: 60 },
    [CUES.cut]: {
      wave: "triangle",
      freq: 880,
      freqTo: 1320,
      gain: 0.18,
      durationMs: 150,
    },
    [CUES.levelUp]: {
      wave: "triangle",
      freq: 392,
      freqTo: 1046,
      gain: 0.2,
      durationMs: 340,
    },
    [CUES.gameOver]: {
      wave: "sine",
      freq: 440,
      freqTo: 160,
      gain: 0.2,
      durationMs: 420,
    },
    [MUSIC_TITLE]: { wave: "sine", freq: 262, gain: 0.08, durationMs: 1000 },
    [MUSIC_PLAY]: { wave: "sine", freq: 196, gain: 0.07, durationMs: 1000 },
  };
  for (let rung = 1; rung <= LADDER_RUNGS; rung += 1) {
    specs[ladderCue(rung)] = {
      wave: "triangle",
      // A rung per whole tone, so the ladder climbs audibly even unloaded.
      freq: 330 * Math.pow(2, (rung - 1) / 6),
      gain: 0.18,
      durationMs: 120,
    };
  }
  return specs;
}

/** Declare every cue name, synchronously, before the start level opens. */
export function defineCues(api: Pick<InitApi, "audio">): void {
  for (const [cue, spec] of Object.entries(cueSpecs())) {
    api.audio.define(cue, spec);
  }
}

/**
 * Bind the produced `.wav` over each declared name.
 *
 * Every load is awaited so the sounds are in place before the first frame, and
 * every rejection is swallowed: the engine leaves a name bound to what it had
 * when a load fails, which is the placeholder, so a host with no Web Audio —
 * the build's own test process, for one — still plays every cue by name.
 */
export async function loadCues(api: Pick<InitApi, "audio">): Promise<void> {
  await Promise.all(
    Object.entries(cueFiles()).map(async ([cue, path]) => {
      try {
        await api.audio.load(cue, path);
      } catch {
        // Recorded by the engine as `asset:failed`; the name keeps its spec.
      }
    }),
  );
}

/** The bed a screen plays under it. One of the two sounds on every screen. */
export function musicForScreen(screen: Screen): string {
  return screen === "title" || screen === "howto" ? MUSIC_TITLE : MUSIC_PLAY;
}

/**
 * Ask for the screen's bed. Driven from the state on every frame rather than
 * tracked, which is how engine/audio.md asks a loop to be driven: `loop` on a
 * cue already looping and `stop` on one that is not both do nothing.
 */
export function updateMusic(audio: WorldAudio, screen: Screen): void {
  const wanted = musicForScreen(screen);
  const other = wanted === MUSIC_TITLE ? MUSIC_PLAY : MUSIC_TITLE;
  audio.stop(other);
  audio.loop(wanted);
}

/**
 * Play the cue for each event this frame raised, once each.
 *
 * `rung` is the ladder rung `clear` sounds over its body: the multiplier of the
 * highest step that cleared this frame, clamped so a capped chain holds on the
 * top rung. A frame that raises no `clear` sounds no rung.
 */
export function playFrameEvents(
  audio: WorldAudio,
  events: FacetEvents,
  rung: number,
): void {
  if (events.select) audio.play(CUES.select);
  if (events.swap) audio.play(CUES.swap);
  if (events.refuse) audio.play(CUES.refuse);
  if (events.clear) {
    audio.play(CUES.clear);
    audio.play(ladderCue(Math.min(Math.max(rung, 1), MAX_MULTIPLIER)));
  }
  if (events.land) audio.play(CUES.land);
  if (events.flaw) audio.play(CUES.flaw);
  if (events.cut) audio.play(CUES.cut);
  if (events.levelUp) audio.play(CUES.levelUp);
  if (events.gameOver) audio.play(CUES.gameOver);
}
