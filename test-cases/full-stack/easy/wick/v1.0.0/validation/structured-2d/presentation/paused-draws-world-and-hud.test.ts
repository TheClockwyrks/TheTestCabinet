// presentation/paused-draws-world-and-hud — the pause screen keeps the whole
// playing picture: the world where it stood, and the HUD as it read.
//
// WHERE THE REQUIREMENT COMES FROM. `specs/ui.md`, "`paused`": "The world held
// still, with the HUD, under `PAUSED_TEXT` (`PAUSED`)." "What advances on each
// screen" says what "held" means: on `paused` "Nothing. The world beneath holds
// exactly the tick it was at." Where the world's parts belong is `specs/ui.md`'s
// "The lamplighter is drawn at the stage center `(STAGE_CX, STAGE_CY)`
// (`640, 360`)" and `specs/world.md`'s camera formula; what the HUD carries is
// `specs/ui.md`'s own table — the health bar "with both numbers beside it", the
// experience bar "labeled with `LEVEL_LABEL` (`LEVEL`) and the current level",
// the clock "as `m:ss`", the kill count, and the weapon and passive slots
// showing "each held weapon as its icon", the icons being the produced files
// `specs/assets.md` puts at `assets/icons/<id>.png`.
//
// WHAT IS READ, AND WHY IT IS A COMPARISON. The point is that the paused frame
// draws what the last playing frame did, so the reading is taken twice: once on
// a `playing` frame and once on the `paused` frame that follows it with no tick
// between them. The world is held to the positions the state still reports, and
// the HUD to the playing frame's own picture — every run of text that frame
// drew is drawn again, as many times, and every produced icon it blitted is
// blitted again. A subset rather than an equality, because `paused` adds
// `PAUSED_TEXT` of its own.
//
// THE BOUND. `SPRITE_TOL` (2 device pixels) on each drawn centre, the rounding
// a build that lands its destination rectangle on whole device pixels picks up;
// the harness opens at the stage's own `1280 x 720`, where one device pixel is
// one stage unit. Nothing else: a run of text was drawn or it was not, and an
// icon was blitted or it was not. No tick separates the two frames, so a build
// that draws the same picture has nothing to round differently.
//
// THE WORLD, AND WHY. `beneath.ts`'s held world — three moths about a
// lamplighter posed off the world origin, every driver switch off — with a
// weapon and a passive placed in their slots and the run's figures posed to
// values a HUD has to read out, so both the world half and the HUD half of the
// requirement have something to show. `weaponFire` stays off, so no shape
// appears between the two frames.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { ASSET_ROOT } from "../constants";
import {
  captureStill,
  createHarness,
  drawnText,
  holdPassive,
  holdWeapon,
  poseScreen,
  type Blit,
  type DrawCall,
  type Harness,
} from "../harness";
import { assertWorldDrawn, poseHeldWorld } from "./beneath";

/** The run's figures, posed so every HUD readout has something to say. */
const LEVEL = 4;
const XP = 3;
const KILLS = 7;
const HP = 62;

/** The directory every produced icon sits in (`specs/assets.md`, "The icons"). */
const ICON_DIR = `${ASSET_ROOT}/icons/`;

/** How many times each distinct run of text a frame drew was drawn. */
function textCounts(calls: readonly DrawCall[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of drawnText(calls)) {
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return counts;
}

/** Every produced icon a frame blitted, by file. */
function iconsDrawn(blits: readonly Blit[]): Set<string> {
  return new Set(
    blits.flatMap((blit) => (blit.id.startsWith(ICON_DIR) ? [blit.id] : [])),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the world and the HUD on screen under the pause", async () => {
  const ids = poseHeldWorld(h);
  holdWeapon(h, "ember", 3);
  holdPassive(h, "oil", 2);
  h.debug.setLevel(LEVEL);
  h.debug.setXp(XP);
  h.debug.setKills(KILLS);
  h.debug.setHp(HP);

  const playing = await h.frameDraw();
  const before = h.snapshot();
  assertEqual(before.screen, "playing", "the screen the first frame drew");
  const wanted = textCounts(playing.calls);
  assertGreaterThan(wanted.size, 0, "the runs of text the playing frame drew");
  const icons = iconsDrawn(playing.blits);
  assertGreaterThan(
    icons.size,
    0,
    "the produced icons the playing frame blitted",
  );

  // No tick passes between the two frames: `paused` ticks nothing, and a pose
  // is not a tick, so the state the second frame draws is the state the first
  // one drew.
  poseScreen(h, "paused");
  const held = await h.frameDraw();
  captureStill(h, "beneath");
  const after = h.snapshot();
  assertEqual(after.screen, "paused", "the screen the second frame drew");
  assertEqual(after.run.tick, before.run.tick, "the tick under the pause");

  assertWorldDrawn(h, held.blits, after, ids, "under the pause");

  const found = textCounts(held.calls);
  for (const [text, count] of wanted) {
    assertGreaterThanOrEqual(
      found.get(text) ?? 0,
      count,
      `how many times the paused frame drew ${JSON.stringify(text)}, which ` +
        "the playing frame before it drew",
    );
  }

  const heldIcons = iconsDrawn(held.blits);
  for (const icon of icons) {
    assertEqual(
      heldIcons.has(icon),
      true,
      `${icon}, which the playing frame blitted, drawn again under the pause`,
    );
  }
});
