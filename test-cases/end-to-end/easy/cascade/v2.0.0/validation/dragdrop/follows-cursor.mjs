// Automated validation for the Drag-and-drop sub-item `follows-cursor`.
//
// A held card follows the cursor and floats above the table, detached from its
// source pile. This drives real pointer input (pointerDown then pointerMove, see
// specs/instrumentation.md): pressing the waste's top card and moving the cursor,
// the drag's reported position must track the cursor, and the card must be lifted
// clear of the pile it came from. The beats between pointer ops give the video
// output the card gliding under the cursor.
//
// Those beats are `advance`, not `settle`: a drag resolves instantly in Cascade (the
// build's `step` is a no-op off a running cascade), so an advance moves no game state
// and is purely clip pacing — a real pause while recording, free while validating.
//
// DETACHMENT IS CHECKED AS PIXELS, NOT AS PILE BOOKKEEPING. "Floats above the table,
// detached from its source" is a statement about what the player SEES, and the specs
// say only that (specs/states.md: "the held cards follow the pointer and float above
// the table"; specs/overview.md gives the lifted card its shadow). Whether the build
// also pops the card out of `waste` for the duration of the drag is an internal
// modeling choice the specs never mandate: detaching on grab and re-seating on an
// illegal drop, and leaving the pile intact until the drop resolves while the
// renderer hides the grabbed card, are both conformant and look identical on screen.
// An earlier version of this item demanded `waste.length === 0` while held and so
// failed the second kind of build for a difference no reviewer could see. So the
// check reads the canvas instead (`api.pixel` via `sampleColor`): the waste slot must
// stop painting what it painted at rest, and the point under the cursor must not look
// like that vacated slot. Both comparisons are RELATIVE — a build's palette and its
// empty-slot treatment are its own — so they hold for any card art while still being
// impossible to pass without actually lifting the card off the pile.
//
// Those two reads are the one thing here that needs a PAINTED frame, hence the
// `api.settle` before each (real milliseconds in both passes); `advance` would step
// the simulation and paint nothing.

import {
  card,
  colorDistance,
  pose,
  sampleColor,
  ticksFor,
  wasteTopCenter,
} from "../_helpers.mjs";

// Pressing at the card's center offsets the grab by half the card, so the drag's
// top-left tracks the cursor minus (CARD_W/2, CARD_H/2) = (50, 70) — and, by the same
// token, the held card's CENTER sits exactly under the cursor, which is where the
// canvas is sampled to see the card in hand.
const GX = 50;
const GY = 70;

// The two cursor points the card is dragged between.
const P1 = { x: 700, y: 400 };
const P2 = { x: 950, y: 220 };

// How far apart two sampled colors must be to count as "a different thing is drawn
// here now". The narrowest real gap this has to clear is a card's own center against
// the bare felt behind it — measured at ~64 for a black suit's central pip, the
// darkest a card face gets — so 30 sits comfortably below any genuine change while
// staying far above antialiasing and compression noise.
const LIFTED = 30;

// Long enough for a frame to paint before the canvas is read. A shorter pause races
// the build's first paint and reads an untouched (transparent black) backing store.
const PAINT_MS = 150;

export default function item() {
  // The King's resting place, and the drag state at each of the two cursor points.
  let top;
  let s1;
  let s2;
  // The waste slot as painted with the card at rest, the same slot while the card is
  // held away from it, and the point under the cursor while it is held.
  let restSlot;
  let heldSlot;
  let heldCard;

  return {
    id: "dragdrop.follows-cursor",

    async arrange(api) {
      await pose(api, { waste: [card("spades", 13, true)] }, 1);
      const snap = await api.snapshot();
      top = wasteTopCenter(snap);
    },

    async act(api) {
      // What the waste slot looks like with the King sitting on it, to compare against.
      await api.settle(PAINT_MS);
      restSlot = await sampleColor(api, top.x, top.y);

      await api.call("pointerDown", top.x, top.y);
      await api.advance(ticksFor(150)); // 18 ticks

      await api.call("pointerMove", P1.x, P1.y);
      await api.advance(ticksFor(300)); // 36 ticks
      s1 = await api.snapshot();

      // With the card held away from the waste: the slot it came from, and the card
      // itself under the cursor.
      await api.settle(PAINT_MS);
      heldSlot = await sampleColor(api, top.x, top.y);
      heldCard = await sampleColor(api, P1.x, P1.y);

      await api.call("pointerMove", P2.x, P2.y);
      await api.advance(ticksFor(300));
      s2 = await api.snapshot();

      await api.call("pointerUp", P2.x, P2.y);
      await api.advance(ticksFor(150));
    },

    async assert(api, check) {
      check.expectNe(
        "a card is held after pressing the waste and moving",
        s1.drag,
        null,
      );
      check.expectEq(
        "the held card is the King",
        s1.drag ? s1.drag.cards[0].rank : 0,
        13,
      );
      check.expectEq(
        "the held run knows it came from the waste",
        s1.drag && s1.drag.source ? s1.drag.source.pile : null,
        "waste",
      );
      check.expectClose(
        "the held card's x tracks the cursor",
        s1.drag ? s1.drag.x : NaN,
        P1.x - GX,
        0.5,
      );
      check.expectClose(
        "the held card's y tracks the cursor",
        s1.drag ? s1.drag.y : NaN,
        P1.y - GY,
        0.5,
      );

      // Detached from its source, as drawn: the pile it came from no longer shows it,
      // and it is on the table under the cursor instead.
      check.expectGt(
        "the card is lifted off the waste — its slot no longer paints it",
        colorDistance(restSlot, heldSlot),
        LIFTED,
      );
      check.expectGt(
        "the held card floats above the table under the cursor",
        colorDistance(heldSlot, heldCard),
        LIFTED,
      );

      check.expectClose(
        "the held card follows to a second point (x)",
        s2.drag ? s2.drag.x : NaN,
        P2.x - GX,
        0.5,
      );
      check.expectClose(
        "the held card follows to a second point (y)",
        s2.drag ? s2.drag.y : NaN,
        P2.y - GY,
        0.5,
      );
    },
  };
}
