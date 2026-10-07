// Spectra — what one advanced frame produced beside the state it advanced.
//
// CUES ARE GATHERED RATHER THAN PLAYED AS THEY HAPPEN, so a frame that raises
// one twice still plays it once, which is what `specs/ui.md` asks for. The mode's
// tick plays the batch at the end of the frame, and plays nothing at all while
// sound is muted.
//
// `dronesRemoved` is what the stage-clear rule reads: `specs/stages.md` makes a
// clear the MOMENT the last drone of a wave is destroyed, so a live wave holding
// no drone that has had none removed is being played rather than cleared — a fact
// about the frame rather than about the field.

import type { CueName } from "./constants";

/** What a frame produced beside the state it advanced. */
export interface FrameEvents {
  readonly cues: Set<CueName>;
  dronesRemoved: number;
}

/** A fresh record of what a frame produced. */
export function newFrameEvents(): FrameEvents {
  return { cues: new Set<CueName>(), dronesRemoved: 0 };
}
