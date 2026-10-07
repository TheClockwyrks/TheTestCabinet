// Wick — one tick of the world (specs/world.md "One tick").
//
// The twelve phases in order, each reading the state the phases before it
// left. A tick runs on `playing` alone; a tick that opens an overlay or ends
// the run leaves `state.screen` on the screen it opened.

import { CUES, PUFF_TIME, TICK_HZ, type CueName } from "../constants";
import type { Rng } from "../rng";
import type { Draft } from "../state";
import { makeTickContext, type Held, type TickContext } from "./context";
import { attractAndCollectGems, collectPickups } from "./drops";
import { expireEffects, moveEffects, resolveDeaths } from "./effects";
import { runDirector } from "./director";
import { ageAndMoveEnemies } from "./enemies";
import { fireWeapons } from "./firing";
import { resolveHits } from "./hits";
import { contact, endings, moveLamplighter, recover } from "./lamplighter";
import { placePermanents } from "./placement";
import { openLevelUp } from "./progression";

/** Puffs are pictures; one is gone after `PUFF_TIME`. */
function prunePuffs(ctx: TickContext): void {
  const { run } = ctx;
  run.puffs = run.puffs.filter(
    (puff) => (run.tick - puff.bornTick) / TICK_HZ < PUFF_TIME,
  );
}

/**
 * Run one tick over `state`, with the movement actions as `held`. Every cue
 * the tick raises lands in `cues`, each at most once.
 */
export function tick(
  state: Draft,
  rng: Rng,
  held: Held,
  cues: Set<CueName>,
): void {
  const ctx = makeTickContext(state, rng, held, cues);
  const { run } = ctx;

  run.tick += 1;
  prunePuffs(ctx);
  moveLamplighter(ctx);
  recover(ctx);
  ageAndMoveEnemies(ctx);
  if (state.weaponFire) fireWeapons(ctx);
  placePermanents(ctx);
  expireEffects(ctx);
  if (state.effectMotion) moveEffects(ctx);
  resolveHits(ctx);
  resolveDeaths(ctx);
  contact(ctx);
  collectPickups(ctx);
  attractAndCollectGems(ctx);
  runDirector(ctx);
  if (endings(ctx)) return;
  if (ctx.chestCollected) {
    state.screen = "chest";
    state.menuIndex = 0;
    cues.add(CUES.chest);
  } else if (run.pendingLevelUps > 0) {
    openLevelUp(state, rng, cues);
  }
}
