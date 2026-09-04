// assets/title-bed-at-least-12s — the title bed runs at least twelve seconds.
//
// specs/assets.md: "Each bed runs at least 12 seconds and loops without an
// audible seam." This point is the length half for the title bed alone: the
// duration the committed `assets/audio/music-title.wav` announces — sample frames over
// sample rate — is at least the figure, which the project's `constants.ts`
// transcribes as `MUSIC_MIN_SECONDS`.
//
// EACH BED IS ITS OWN POINT, because a build whose play bed alone is a
// two-second stub must grade differently from one whose beds are both short. The
// seam belongs to `title-bed-loops-seamlessly`. How the reading is taken, and why
// it allows a hundredth of a second of frame rounding, is `beds.ts`.

import { it } from "vitest";
import { BEDS } from "./bed-audio";
import { assertLongEnough } from "./beds";

it("runs the title bed at least twelve seconds", () => {
  assertLongEnough("title-length", BEDS[0].name, BEDS[0].path);
});
