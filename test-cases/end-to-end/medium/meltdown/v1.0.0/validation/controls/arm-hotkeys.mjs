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

import { newGame, press, TOWER_TYPES, actTail } from "../_helpers.mjs";

// How long each armed type is held before the next digit. 22 ticks is about 0.37 s, so
// the eight of them cycle the whole shop in a shade under three seconds — long enough
// to see each preview, short enough that the clip is still a cycle rather than a
// slideshow.
const HOLD = 22;

export default function item() {
  const armed = [];

  return {
    id: "controls.arm-hotkeys",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
    },

    // The key presses are the behavior, so they are what the clip shows: each digit
    // swapping the held preview for a different shop tower.
    //
    // A BEAT BETWEEN EACH PRESS. All eight presses and their snapshots resolve
    // instantly, so run together they landed inside a single frame: the clip opened on
    // whatever the EIGHTH digit had armed and held it, and the seven swaps this item is
    // about — the shop entry lighting up, the held footprint changing size, the range
    // ring resizing — were never on screen at all. A short hold on each turns the drive
    // into what it claims to be: the shop cycling through all eight types, one key at a
    // time, in about three seconds. It costs the verdict nothing; each reading is still
    // taken on its own press.
    async act(api) {
      for (let digit = 1; digit <= TOWER_TYPES.length; digit += 1) {
        await press(api, `Digit${digit}`);
        const s = await api.snapshot();
        armed.push(s.build ? s.build.type : null);
        await api.advance(HOLD);
      }

      // And a beat on the last one, so the clip does not cut on the eighth press.
      await actTail(api, 120);
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
