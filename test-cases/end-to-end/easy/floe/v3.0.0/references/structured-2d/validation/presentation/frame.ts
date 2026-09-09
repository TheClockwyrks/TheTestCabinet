// presentation — ONE frame's own record of what the build drew. PRIVATE to
// `presentation/`.
//
// The shared harness records every call and property set the render makes onto
// `h.calls`, and it never clears that list: a check that ran a hundred frames
// holds a hundred frames of drawing. Every point in this group reads what ONE
// frame drew — which bitmap landed on the critter, which runs of text the HUD
// bar carried, how the picture changed when a bay was posed filled — so each of
// them needs the list to hold that frame and nothing before it.
//
// So this is the whole of it: forget what came before, run one frame, and leave
// `h.calls` holding exactly what that frame issued. The harness's readers —
// `drawnImages`, `drawnTextRuns`, `drawnTextSpans`, `drawnText` — all walk
// `h.calls`, so after this they are reading the frame this returned rather than
// the run so far.
//
// It advances the simulation by one tick, like any other frame. A check that
// must not step the game between an arrangement and its reading has already
// been mis-posed: the surface's poses land at the call (specs/instrumentation.md)
// and the picture is only drawn by a frame, so the frame that draws an
// arrangement is the frame after it.

import type { Harness } from "../harness";

/** Run one frame, leaving `h.calls` holding exactly what that frame drew. */
export async function renderFrame(h: Harness): Promise<void> {
  h.calls.length = 0;
  await h.advance(1);
}
