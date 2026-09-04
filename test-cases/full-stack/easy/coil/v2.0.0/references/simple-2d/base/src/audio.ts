// Coil — audio, as engine cues (specs/ui.md "Audio", specs/assets.md).
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// engine owns the context, the mute state, the looping, and the first-gesture
// unlock. The game's whole part is to DECLARE the four cues `src/constants.ts`
// names and then play them BY NAME as the events happen, each on the tick its
// event resolves and at most once on that tick.
//
// Each cue is DECLARED TWICE, and the order matters. A synthesized shape is
// defined first, which cannot fail, and the produced `.wav` `specs/assets.md`
// fixes is then loaded over the same name, which replaces what that name plays.
// The produced files are what a player hears. What the first declaration buys is
// the requirement that audio which fails to load leaves the game running: a cue
// name that was never declared throws when it is played, so a build that declared
// nothing until a fetch resolved would fall over on a host that could not reach
// its files instead of carrying on, quieter, exactly as specified.

import { CUES, CUE_PATHS, type CueName } from "./constants";
import type { TickEvents } from "./sim";
import type { CueSpec, InitApi, UpdateApi } from "@test-cabinet/simple-2d";

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
 * Declare every cue, once, before the first frame, and load the produced file
 * behind each over it.
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
export function playTickEvents(
  api: Pick<UpdateApi, "audio">,
  events: TickEvents,
): void {
  if (events.ate) api.audio.play(CUES.eat);
  if (events.comboRose) api.audio.play(CUES.comboUp);
  if (events.died) api.audio.play(CUES.death);
}
