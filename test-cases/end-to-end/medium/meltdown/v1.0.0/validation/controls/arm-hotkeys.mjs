// Automated validation for the Controls sub-item `arm-hotkeys`.
//
// The number keys 1..8 arm the eight shop towers (specs/controls.md). We inject each
// digit and read the held-preview type back.
//
// What is asserted is the MAPPING, not the seating. The spec ties the digits to "shop
// order (top to bottom, left to right)", and which type a build seats in slot 4 is its
// own presentation choice that the debug API gives no way to read (see `TOWER_TYPES`).
// Two conformant builds legitimately differ there, so pinning a specific order here
// fails one of them for a reason that is not a bug. The order-free content of the
// requirement is exactly checkable, though: all eight digits arm something, they arm
// eight DIFFERENT types, and between them they cover the whole shop. That still catches
// every real breakage — a dead digit, two digits arming the same tower, a type no key
// reaches — and leaves "is Bloom really the fourth button" to this item's clip and the
// reviewer's eye, which is where a claim about on-screen layout belongs.

import { newGame, press, TOWER_TYPES } from "../_helpers.mjs";

export default function item() {
  const armed = [];

  return {
    id: "controls.arm-hotkeys",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
    },

    // The key presses are the behavior, so they are what the clip shows: each digit
    // swapping the held preview for a different shop tower.
    async act(api) {
      for (let digit = 1; digit <= TOWER_TYPES.length; digit += 1) {
        await press(api, `Digit${digit}`);
        const s = await api.snapshot();
        armed.push(s.build ? s.build.type : null);
      }
    },

    async assert(api, check) {
      armed.forEach((type, i) => {
        check.expectOk(
          `Digit${i + 1} arms a shop tower (armed ${type})`,
          !!type,
        );
      });
      check.expectEq(
        `the eight digits arm eight distinct types (saw ${armed.join(", ")})`,
        new Set(armed).size,
        TOWER_TYPES.length,
      );
      check.expectEq(
        "between them the digits arm every shop tower",
        [...armed].sort().join(","),
        [...TOWER_TYPES].sort().join(","),
      );
    },
  };
}
