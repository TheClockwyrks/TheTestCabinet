// movement — delivering a stretch of game time as a chosen number of updates.
//
// WHY THIS IS HERE AND NOT IN THE HARNESS. The harness drives the game at one
// fixed frame rate (`FRAME_HZ`), which is what every other point in this project
// wants: a tick is a whole number of its frames and nothing has to think about
// the division. Two points in this directory are ABOUT that division —
// `sub-tick-update-runs-no-tick` hands the game less than a tick, and
// `subdivision-invariant` hands it the same second cut two different ways — so
// they need a delivery the harness does not offer.
//
// specs/instrumentation.md puts exactly that on the surface: `advance(seconds,
// frames)` "runs `frames` whole frames covering `seconds` of game time, each
// worth `seconds / frames`". This helper is a thin driver over it that also opens
// and closes the injected recorder's frame boundary around each update, exactly
// as the harness's own driver does, so a section driven this way is kept as
// evidence like any other.

import { HANDLE, type Harness } from "../harness";

/**
 * Hand the game `seconds` of game time as `updates` equal updates.
 *
 * Each update is one call to the surface's `advance` covering `seconds /
 * updates`, run inside a single crossing so nothing the page's own animation
 * frame does can land between two of them, and bracketed by the recorder so the
 * frames are kept when a capture is armed.
 */
export async function deliver(
  h: Harness,
  seconds: number,
  updates: number,
): Promise<void> {
  await h.page.evaluate(
    ([handle, total, count]) => {
      const api = (
        window as unknown as Record<
          string,
          { advance(seconds: number, frames?: number): void }
        >
      )[handle];
      const rec = (
        window as unknown as {
          __coilRec: { begin(): void; end(deltaMs: number): void };
        }
      ).__coilRec;
      const each = total / count;
      for (let i = 0; i < count; i += 1) {
        rec.begin();
        api.advance(each, 1);
        rec.end(each * 1000);
      }
    },
    [HANDLE, seconds, updates] as const,
  );
}
