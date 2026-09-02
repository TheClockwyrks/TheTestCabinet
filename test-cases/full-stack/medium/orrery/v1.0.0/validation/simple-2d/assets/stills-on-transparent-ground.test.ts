// assets/stills-on-transparent-ground — the sprite stills are authored on
// transparency.
//
// THE RULE. "Each of these is one sprite, produced with `draw` on a transparent,
// straight-alpha canvas of exactly the size its row states, and drawn at native
// size" (`specs/assets.md`, The sprites), and the art bar says what that buys:
// "Every sprite reads on the dark sky, and none of them relies on a background
// behind it." The sky itself is What stays drawn in code — "The sky and the hex
// field's ninety-one cells", fixed by `specs/field.md` — so a still that carries its
// own ground paints a rectangle over the field it is meant to sit on, and every
// mote, glyph, hub, gripper and mount stamps a tile on the hex it stands on.
//
// WHICH STILLS. Every row of the sprite table, which is every produced picture that
// is not a sheet frame: the fifteen motes, the two filament strips, the twelve sigil
// glyphs, the ten instruction glyphs, the two arm hubs, the two grippers, the wheel
// hub and the fixture mount. The sheets are the point beside this one, because their
// requirement is worded in The sheets rather than here.
//
// WHAT IT READS. Every still decodes, and at least `GROUND_MIN_SHARE` of its canvas
// is clear — alpha at or below `GROUND_ALPHA`. `specs/assets.md` fixes no coverage
// figure, and a sprite drawn right out to the edge of its canvas is conformant, so
// the floor is deliberately low at one twentieth: what it catches is a canvas that
// was FLOODED, which is the failure "none of them relies on a background behind it"
// is about. A file whose every pixel is opaque cannot clear it however it was drawn.
//
// WHAT IT DOES NOT DECIDE. Whether the alpha is STRAIGHT rather than premultiplied
// is not readable from a decoded canvas, which hands back straight-alpha bytes
// whatever the file stored; and whether a still READS on the dark sky is the art bar
// itself, and the reviewer's judgement.
//
// THE EVIDENCE is every still magnified over a checkerboard: wherever the checker
// shows through, that canvas was transparent there, and a still that hides the
// checker entirely is the one this point fails on.

import { it } from "vitest";
import { assertGreaterThanOrEqual, assertLength, fail } from "../assert";
import {
  FILAMENT_SPRITES,
  GRIPPER_SPRITES,
  HUB_SPRITES,
  INSTRUCTION_SPRITES,
  MOTE_SPRITES,
  PRODUCED_SPRITES,
  RISE_SPRITES,
  SET_SPRITES,
  SIGIL_SPRITES,
  WHEEL_SPRITES,
} from "./files";
import {
  GROUND_MIN_SHARE,
  decodeProduced,
  groundShare,
  showSprites,
} from "./sprites";

/** The sprite table's rows, in the order `specs/assets.md` tabulates them. */
const STILLS = [
  ...MOTE_SPRITES,
  ...FILAMENT_SPRITES,
  ...SIGIL_SPRITES,
  ...INSTRUCTION_SPRITES,
  ...HUB_SPRITES,
  ...GRIPPER_SPRITES,
  ...WHEEL_SPRITES,
];

it("leaves clear ground on every one of the produced stills", async () => {
  await showSprites("checkerboard", STILLS);

  assertLength(
    STILLS,
    PRODUCED_SPRITES.length - RISE_SPRITES.length - SET_SPRITES.length,
    "every produced sprite but the twelve sheet frames, so the sweep below is the whole sprite table",
  );
  const readings = await decodeProduced(STILLS);
  for (const [index, row] of STILLS.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    assertGreaterThanOrEqual(
      groundShare(read.sprite),
      GROUND_MIN_SHARE,
      `${row.label}: the share of its canvas left as clear ground`,
    );
  }
});
