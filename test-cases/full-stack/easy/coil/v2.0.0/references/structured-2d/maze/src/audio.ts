// Coil — audio, as engine cues (specs/ui.md "Audio", specs/assets.md).
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// engine owns the context, the mute state, the looping, and the first-gesture
// unlock. The game's whole part is to DECLARE the four cues `src/constants.ts`
// names, once, from the instance's `initialize`, and then play them BY NAME on
// the world's cue bus as the events happen, each on the tick its event resolves
// and at most once on that tick.
//
// Each cue is DECLARED TWICE, and the order matters. A synthesized shape is
// defined first, which cannot fail, and the produced `.wav` `specs/assets.md`
// fixes is then loaded over the same name, which replaces what that name plays.
// The produced files are what a player hears. What the first declaration buys is
// the requirement that audio which fails to load leaves the game running: the
// engine throws on a cue name that was never declared, so a build that declared
// nothing until a fetch resolved would fall over on a host that could not reach
// its files instead of carrying on, quieter, exactly as specified.

import { CUES, CUE_PATHS, type CueName, type Screen } from "./constants";
import type { TickEvents } from "./sim";
import type { CueSpec, InitApi, WorldAudio } from "@test-cabinet/structured-2d";

/**
 * The shape each cue falls back to when its produced file is unavailable.
 *
 * Pitched and shaped the way the produced sounds are (`specs/assets.md`, "The
 * sound bar"): a short dry tick for the eat, a brighter and higher one for the
 * multiplier, and one heavy low sweep for the death, well apart by ear.
 */
export const CUE_FALLBACKS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.eat]: {
    wave: "square",
    freq: 660,
    freqTo: 880,
    gain: 0.14,
    durationMs: 55,
  },
  [CUES.comboUp]: {
    wave: "triangle",
    freq: 880,
    freqTo: 1320,
    gain: 0.16,
    durationMs: 110,
  },
  [CUES.death]: {
    wave: "sawtooth",
    freq: 220,
    freqTo: 70,
    gain: 0.2,
    durationMs: 520,
  },
  [CUES.music]: {
    wave: "sine",
    freq: 110,
    gain: 0.06,
    durationMs: 1000,
  },
};

/**
 * Declare every cue, once, before the start level opens, and load the produced
 * file behind each over it.
 *
 * A load that fails is caught rather than thrown: the name keeps the shape
 * `CUE_FALLBACKS` gave it, the game stays fully playable, and the engine has
 * already announced the failure as an `asset:failed` event for anyone watching.
 */
export async function defineCues(api: Pick<InitApi, "audio">): Promise<void> {
  for (const [cue, spec] of Object.entries(CUE_FALLBACKS)) {
    api.audio.define(cue, spec);
  }
  await Promise.all(
    (Object.keys(CUE_PATHS) as CueName[]).map((cue) =>
      api.audio.load(cue, CUE_PATHS[cue]).catch(() => undefined),
    ),
  );
}

/**
 * Play the cue for each event one tick raised.
 *
 * A tick that both eats a pellet and raises the multiplier plays `eat` and
 * `combo-up` once each, and a tick that raised nothing plays nothing.
 */
export function playTickEvents(audio: WorldAudio, events: TickEvents): void {
  if (events.ate) audio.play(CUES.eat);
  if (events.comboRose) audio.play(CUES.comboUp);
  if (events.died) audio.play(CUES.death);
}

/**
 * Sound the music bed for a round that has just begun (specs/ui.md).
 *
 * `specs/ui.md` plays `music` when "a round begins", so it is played from the one
 * path that LAYS A ROUND OUT rather than reconciled against the screen. A screen
 * reaching `playing` is not a round beginning: `RESUME` returns to the round
 * already running, and `specs/instrumentation.md` says of a posed screen that it
 * "runs the tick over the board as it stands rather than laying out a fresh
 * round". Reconciling would sound the bed on both.
 *
 * A bed already running is stopped first, so a fresh round always starts the bed
 * fresh — `RESTART` from the pause menu leaves the previous round's bed playing
 * otherwise, and that round has ended.
 */
export function startMusic(audio: WorldAudio): void {
  if (audio.looping(CUES.music)) audio.stop(CUES.music);
  audio.loop(CUES.music);
}

/**
 * Stop the music bed once the round it was playing under is over (specs/ui.md:
 * "Once the round has ended the bed is stopped rather than left running
 * quietly").
 *
 * Reconciled every frame rather than stopped at the transitions, because a round
 * can also be left through the debug surface. Only the STOP is reconciled this
 * way: see {@link startMusic} for why the start is not.
 */
export function stopMusicOffTheRound(screen: Screen, audio: WorldAudio): void {
  const under = screen === "playing" || screen === "paused";
  if (!under && audio.looping(CUES.music)) audio.stop(CUES.music);
}
