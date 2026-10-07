// assets/play-bed-produced — the play bed ships as a produced track.
//
// specs/assets.md: "Produce two beds with `music` ... `music` writes a `.wav`
// and a `.mid` beside it; the `.wav` is what the game plays", and its table
// lands the play bed at `assets/audio/music-play.wav`. What is read off the committed
// file is exactly that: it exists, it decodes as a WAV, and it carries audible
// signal rather than silence.
//
// EACH BED IS ITS OWN POINT, because a build that produced one and left the
// other a stub must grade differently from one that produced neither. That the
// bed is LONG ENOUGH is `play-bed-at-least-12s`, and that it LOOPS is
// `play-bed-loops-seamlessly`. How the reading is taken, and why its silence line
// is a tolerance rather than a spec figure, is `beds.ts`.

import { it } from "vitest";
import { BEDS } from "./bed-audio";
import { assertAudible } from "./beds";

it("ships the play bed as a produced, audible WAV", () => {
  assertAudible("play-bed", BEDS[1].name, BEDS[1].path);
});
