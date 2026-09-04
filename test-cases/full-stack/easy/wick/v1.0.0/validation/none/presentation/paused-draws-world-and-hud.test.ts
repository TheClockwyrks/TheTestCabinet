// presentation/paused-draws-world-and-hud — the pause screen is drawn OVER the
// world and the HUD, both exactly as the last playing frame drew them.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md` — "paused": "The world held still,
// with the HUD, under `PAUSED_TEXT` (`PAUSED`)." Under "What advances on each
// screen", `paused` advances "Nothing. The world beneath holds exactly the tick it
// was at." `specs/overview.md` names the same thing among what a player reads at a
// glance: "The level-up overlay, the chest overlay, and the pause screen read over
// the frozen world beneath them, with that world visibly quieted."
//
// WHY THE HUD IS PART OF THIS ONE AND NOT THE OTHER TWO. `specs/ui.md` names the
// HUD for the pause screen alone, and it is the difference that matters to a
// player: a pause is a screen you read your health and your slots on.
//
// HOW THE PAUSE IS REACHED. `setScreen("paused")`, which
// `specs/instrumentation.md` defines as setting `screen` and nothing else, with
// "the accumulator ... discard[ed], as every frame and pose that leaves
// `playing` does". No key is pressed on the way,
// because a build with a broken `KeyP` and a working pause screen must fail the
// key's point and pass this one.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held, two
// enemies of different types posed at different places, and a HUD given something
// to say: Taper held in a slot, `hp` at `73`, and `12` kills, so the frame carries
// a bar, an icon, numbers, and a count that a build could drop one of. Every
// faculty stays off, so nothing fires, moves or is collected under the reading.
//
// WHAT IS READ. Two things. Where the frame drew the lamplighter and each enemy,
// on the last `playing` frame and then on sixty `paused` frames, each still drawn
// from its own produced file at the world position the held tick left it. And the
// text: every run the playing frame drew is still drawn on the paused frame, which
// is what "with the HUD" asks for; the pause is free to ADD `PAUSED_TEXT` and
// whatever else it shows, so only what went missing is read.
//
// THE TOLERANCE. `BLIT_TOL`, one logical unit on a drawn centre, which is one
// device pixel at the harness's fit. The text has none: a run the playing frame
// drew is either still on the paused frame or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSED_TEXT, type EnemyId } from "../constants";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  addedText,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  placeEnemy,
  readout,
  type Harness,
} from "../harness";
import { assertSamePlacement, placementOf, primePlacement } from "./beneath";

/** Two enemies of different types, at different places inside the view. */
const POSED: ReadonlyArray<{ type: EnemyId; dx: number; dy: number }> = [
  { type: "moth", dx: 260, dy: -140 },
  { type: "beetle", dx: -300, dy: 170 },
];

/** What the HUD is given to say, so there is something for it to lose. */
const HP = 73;
const KILLS = 12;

/** Paused frames read after the pause is entered. */
const HELD_FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the world and the HUD drawn under the pause screen", async () => {
  const posed = await isolate(h);
  await primePlacement(
    h,
    POSED.map((entry) => entry.type),
  );

  const at = posed.run.player;
  const types = new Map<number, EnemyId>();
  for (const entry of POSED) {
    const enemy = await placeEnemy(
      h,
      entry.type,
      at.x + entry.dx,
      at.y + entry.dy,
    );
    types.set(enemy.id, entry.type);
  }
  await holdWeapon(h, "taper", 1);
  await h.debug.setHp(HP);
  await h.debug.setKills(KILLS);

  const playing = await h.step(1);
  assertEqual(playing.screen, "playing", "the screen the world was read on");
  const before = await placementOf(h, playing, types, "the last playing frame");
  const drawnText = await readout(h);
  assertGreaterThan(
    drawnText.runs.length,
    0,
    "runs of text on the playing frame, which is the HUD the pause screen " +
      "keeps (specs/ui.md)",
  );

  await h.debug.setScreen("paused");
  for (let frame = 1; frame <= HELD_FRAMES; frame += 1) {
    const held = await h.step(1);
    assertEqual(
      held.screen,
      "paused",
      `the screen on paused frame ${frame}, which nothing here leaves ` +
        "(specs/ui.md)",
    );
    assertSamePlacement(
      before,
      await placementOf(h, held, types, `paused frame ${frame}`),
      `paused frame ${frame}`,
    );
    const paused = await readout(h);
    assertLength(
      addedText(paused, drawnText),
      0,
      `the runs of text the last playing frame drew that paused frame ` +
        `${frame} no longer draws, which is none of them: the pause keeps the ` +
        `HUD and adds ${PAUSED_TEXT} over it (specs/ui.md)`,
    );
  }
  await captureStill(h, "beneath");
});
