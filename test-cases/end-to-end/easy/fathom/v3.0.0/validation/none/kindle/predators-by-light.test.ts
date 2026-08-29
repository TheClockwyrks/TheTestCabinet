// kindle/predators-by-light — predators are drawn by the light, not the circle.
//
// `specs/sensing.md`, of the vision circle: "Predators are not governed by it. A
// predator is drawn by the light pocket below, by a sonar mark, by a flare and by
// its own detection alert, and the vision circle draws none." `specs/state.md`:
// `lit` is "true while its body is being drawn this instant, whether by the
// forager's light, a sonar mark, a flare, or its own alert."
//
// So the circle governs the maze and the light governs the hunters, and the one
// place those two answers differ is the band between `V` and `R`. A hunter posed
// there is inside the circle and outside the light: it must report `lit` false
// and draw nothing. Then the same hunter is brought inside `V` with the corridor
// straight between them, and must report `lit` true.
//
// BOTH HALVES ARE REQUIRED. On its own "it is not drawn" is satisfied by a build
// that never draws a predator at all — including one whose snapshot simply always
// reports `lit: false` — so the point could be earned for the wrong reason. The
// second reading is what says the LIGHT is what decides.
//
// THE GLOAMFIN IS THE HUNTER for this, and the choice matters. The Lanternjaw
// carries a bulb-light, which is one of the two amber lights and IS clipped to
// the circle rather than to the light pocket (`specs/sensing.md`), so a
// Lanternjaw standing in this band draws an amber mote legitimately. The
// Flarefish blooms. The Gloamfin produces no light of its own, so what is drawn
// where it stands is exactly what this point is asking about.
//
// THE MINDS ARE OFF. `setCreatureAI(false)` holds every creature exactly where it
// stands "and does not move, however long the scenario runs", leaving the rest of
// the simulation running (`specs/instrumentation.md`) — so the hunter is read at
// the distance it was posed at rather than wherever a chase took it, and the
// forager's light still falls where it falls.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  placePredator,
  poseMaze,
  predatorIndex,
  visibilityAt,
} from "../fixtures";
import {
  brightestNear,
  captureStill,
  colorDistance,
  createHarness,
  tileColor,
  windowRadius,
  type Harness,
} from "../harness";
import {
  clearUnderfoot,
  denAllExcept,
  parkForager,
  requireSceneHeld,
  sceneGuard,
  startPlaying,
} from "../scene";
import { FOG_MATCH } from "./_kindle";

/**
 * The board: one straight corridor, and across eight tiles of solid rock a sealed
 * three-tile pocket nothing can ever reach.
 *
 * `F` is the forager, `P` the far berth `BAND_TILES` along the corridor, `N` the
 * near berth inside the light pocket, and `S` the fog reference.
 */
const ART = [".FN..P." + " ".repeat(8) + "S.."] as const;

/** How far the far berth stands from the forager, in tiles. */
const BAND_TILES = 4; // 128 units: past V (96), inside R (192)

/** How far the near berth stands from it, in tiles. */
const LIT_TILES = 1; // 32 units, well inside V

/** The review item's bound on "draws no body", as an RGB distance out of `441`. */
const NO_BODY_MAX = FOG_MATCH;

/** Ticks between posing the hunter and reading what the build drew for it. */
const SETTLE_TICKS = 2;

let h: Harness;

beforeEach(async (ctx) => {
  h = await createHarness(ctx);
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a hunter inside the circle but beyond the light undrawn, and draws it inside the light", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const home = board.mark("F");
  const band = board.mark("P");
  const close = board.mark("N");
  const unlit = board.mark("S");

  const gloamfin = predatorIndex(await h.snapshot(), "gloamfin");
  if (gloamfin === null) {
    // Which hunters the depth-1 roster carries is `scoring/depth-scaling`'s
    // verdict; with no Gloamfin there is nothing here to pose.
    h.unmet(
      "the roster carries no Gloamfin, which is the hunter this scenario poses " +
        "— what the depth-1 roster holds is the progression checks' verdict, " +
        "not this one's",
    );
  }
  const quiet = await denAllExcept(h, [gloamfin]);
  await placePredator(h, gloamfin, band, { state: "wander" });
  await parkForager(h, home);
  await clearUnderfoot(h);
  // Held where it was posed: this point is about what is DRAWN at a distance, not
  // about where a hunter goes next.
  await h.debug.setCreatureAI(false);
  const guard = await sceneGuard(h, quiet);

  await h.advance(SETTLE_TICKS);
  const beyondLight = await h.snapshot();
  const hunter = beyondLight.predators[gloamfin];
  const fog = await tileColor(h, beyondLight, unlit);
  const atHunter = await brightestNear(h, hunter.x, hunter.y);
  // Before the assertions, so a check that fails still leaves the picture of the
  // hunter that should not be there.
  await captureStill(h, "bylight");

  requireSceneHeld(h, beyondLight, guard);

  const gap = Math.hypot(
    hunter.x - beyondLight.forager.x,
    hunter.y - beyondLight.forager.y,
  );
  const radius = windowRadius(beyondLight);
  // The band this point lives in has to exist on this build, or there is nothing
  // here to decide.
  if (gap >= radius || gap <= beyondLight.visionRadius) {
    h.unmet(
      `the hunter posed ${BAND_TILES} tiles off stands ${gap.toFixed(1)} units ` +
        `from the forager, which is not between the reported V of ` +
        `${beyondLight.visionRadius.toFixed(1)} and R of ${radius.toFixed(1)} — ` +
        "whether those radii take their stated values is the brightness and " +
        "grows-with-eating checks' verdict, not this one's",
    );
  }
  assertLessThan(
    gap,
    radius,
    "the logical units between the forager and the hunter, against the vision " +
      "circle R it stands inside",
  );
  assertGreaterThan(
    gap,
    beyondLight.visionRadius,
    "the same distance against the light pocket V it stands outside",
  );

  // Inside the circle, outside the light: nothing of it is drawn.
  assertEqual(
    hunter.lit,
    false,
    `the Gloamfin's \`lit\` while it stands ${gap.toFixed(0)} units off, inside ` +
      "the vision circle and beyond the light pocket",
  );
  assertEqual(
    visibilityAt(beyondLight, band),
    "u",
    `the hunter's tile at (${band.tx}, ${band.ty}), which no light has revealed`,
  );
  assertLessThanOrEqual(
    colorDistance(atHunter.color, fog),
    NO_BODY_MAX,
    "the RGB distance out of 441 between the brightest pixel drawn where the " +
      "hunter stands and the unrevealed fog around it: the circle draws no predator",
  );

  // And inside the light, with the corridor straight between them, it is.
  await placePredator(h, gloamfin, close);
  await h.advance(SETTLE_TICKS);
  const inLight = await h.snapshot();
  const near = inLight.predators[gloamfin];
  assertLessThan(
    Math.hypot(near.x - inLight.forager.x, near.y - inLight.forager.y),
    inLight.visionRadius,
    `the logical units between the forager and the hunter brought back to ` +
      `${LIT_TILES} tile, against the light pocket V`,
  );
  assertEqual(
    near.lit,
    true,
    "the Gloamfin's `lit` inside the light pocket with clear line of sight: the " +
      "light is what draws a hunter",
  );
});
