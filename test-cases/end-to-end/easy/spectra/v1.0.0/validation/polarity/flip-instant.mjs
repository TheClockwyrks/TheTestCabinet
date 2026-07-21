// Automated validation for the Polarity sub-item `flip-instant`.
//
// Flipping bands is instant: the ship's band changes the moment the flip is
// triggered, with no delay. The ship's band is posed, a REAL flip performed, and
// the band read back immediately (no advance) — the change is instantaneous.

import { startClean } from "../_helpers.mjs";

// A beat between the two flips. Nothing about a flip needs time — each band is read
// the instant its flip lands — but back-to-back flips in one frame would film as a
// single flicker, and the clip should show two distinct changes.
const BEAT_TICKS = 36;

export default function item() {
  // The band at the start and after each flip.
  let start;
  let afterFirst;
  let afterSecond;

  return {
    id: "polarity.flip-instant",

    // A live stage-1 wave with its swarm kept, the ship posed on a known band. The
    // wave is kept so the flips are seen against live play — nothing on the field is
    // read by the assertions.
    async arrange(api) {
      await startClean(api, { clear: false });
      await api.call("setShipBand", "cyan");
      start = (await api.snapshot()).ship.band;
    },

    async act(api) {
      await api.call("flip");
      // No advance: read the band the instant the flip happened. This is the whole
      // check — a build that eased or delayed the change would read the old band.
      afterFirst = (await api.snapshot()).ship.band;
      await api.advance(BEAT_TICKS);

      // And back the other way.
      await api.call("flip");
      afterSecond = (await api.snapshot()).ship.band;
      await api.advance(BEAT_TICKS);
    },

    async assert(api, check) {
      check.expectEq("the ship starts on the posed band", start, "cyan");
      check.expectEq(
        "the flip changes the band instantly",
        afterFirst,
        "magenta",
      );
      check.expectEq(
        "a second flip returns the band instantly",
        afterSecond,
        "cyan",
      );
    },
  };
}
