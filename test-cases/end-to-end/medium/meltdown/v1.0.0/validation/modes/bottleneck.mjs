// Automated validation for the Modes sub-item `bottleneck`.
//
// Bottleneck restricts building to a marked central zone — "a placement any tile of
// which falls outside the zone is refused and shown invalid, exactly like any other
// invalid placement" (specs/modes.md). We confirm a placement inside the central zone is
// valid and one in a corner outside it is refused.
//
// TWO STILLS, EACH WITH THE TOWER ACTUALLY HELD OVER THE SPOT.
//
// The old single screenshot was of the bare floor with the zone drawn on it, taken while
// nothing was held. That shows where a build is ALLOWED, which is half the claim, and it
// shows nothing at all about what happens when a player tries to build outside it —
// which is the half the rule is. And a refusal is an absence: a frame with no tower in
// the corner is equally a frame in which nobody tried.
//
// What the build draws instead is the valid/invalid footprint highlight (`#46d07a`
// valid, `#ff4d4d` invalid, specs/controls.md), which is exactly the difference this
// item is about — so the preview is armed and parked over each spot in turn and the
// still is taken there. The pair reads directly: the same tower, green inside the zone,
// red outside it.
//
// This inverts `build`'s park-the-preview-elsewhere rule deliberately (see `build` in
// `_helpers`): there the overlay would sit on a tower a check wanted to sample, while
// here the overlay IS the evidence.

import { newGame } from "../_helpers.mjs";

// A spot well inside the central zone, and a far corner that cannot be in it. The zone
// "spans both straight vent-to-exhaust corridors" (specs/modes.md), so the middle of the
// floor is inside on any conformant layout and tile (1, 1) is outside on all of them.
const INSIDE = [20, 15];
const OUTSIDE = [1, 1];

export default function item() {
  let inside;
  let outside;
  let heldInside;
  let heldOutside;

  return {
    id: "modes.bottleneck",

    async arrange(api) {
      await newGame(api, "bottleneck");
    },

    // Ask the real placement validator about each spot, and park the held preview there
    // so the still carries the build's own valid/invalid highlight.
    async act(api) {
      await api.call("armTower", "arc");

      await api.call("movePreview", INSIDE[0], INSIDE[1]);
      inside = await api.call("canPlace", "arc", INSIDE[0], INSIDE[1], 0);
      heldInside = (await api.snapshot()).build;
      await api.settle(120);
      await api.screenshot("inside");

      await api.call("movePreview", OUTSIDE[0], OUTSIDE[1]);
      outside = await api.call("canPlace", "arc", OUTSIDE[0], OUTSIDE[1], 0);
      heldOutside = (await api.snapshot()).build;
      await api.settle(120);
      await api.screenshot("outside");
    },

    async assert(api, check) {
      check.expectEq(
        "a placement inside the central zone is allowed",
        inside,
        true,
      );
      check.expectEq("a placement outside the zone is refused", outside, false);

      // The preview's own valid flag, which is what the still is a picture of. Without
      // this the two frames could both be showing the same highlight and only
      // `canPlace` would know the difference — and `canPlace` is a pure read that a
      // build could answer correctly while drawing the preview wrong.
      check.expectEq(
        "the held preview reads valid inside the zone",
        heldInside ? heldInside.valid : null,
        true,
      );
      check.expectEq(
        "and invalid outside it",
        heldOutside ? heldOutside.valid : null,
        false,
      );
    },
  };
}
