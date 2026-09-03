// The picture, as actors in the open world.
//
// `specs/state.md` puts the whole authoritative game in `GantryState` and
// leaves the actors, components, and controllers to draw it and drive it, so
// this module is the composition: which actors the level's world holds, and the
// one call a frame that hands each of them the state to bring itself into line
// with.
//
// The engine collects every enabled, visible render component each frame and
// draws it (`engine/rendering.md`), in two passes: the world pass through the
// world's camera, and the screen pass over it in the stage's logical units. The
// yard is the first; the readouts are the second.

import type { World } from "@test-cabinet/structured-3d";
import { GantryView, viewFrame } from "./actor-view";
import { GroundActor } from "./yard/ground";
import { SiteActor } from "./yard/site";
import { CraneActor } from "./yard/crane";
import { PartsActor } from "./yard/parts";
import { BuildActor } from "./hud/build";
import { MutedActor, ScrimActor } from "./hud/chrome";
import { HowToActor } from "./hud/howto";
import { ProgramActor } from "./hud/program";
import { ResultsActor } from "./hud/results";
import { RunActor } from "./hud/run";
import { SelectActor } from "./hud/select";
import { TitleActor } from "./hud/title";
import type { GantryState } from "./game";

/**
 * Spawn the world-space half of the yard: the ground, the sky, and the light;
 * the site's fixtures and the build aids; the crane's own geometry; and the
 * produced models standing wherever their subjects are.
 *
 * The yard is drawn on every screen, and the menu screens lay a scrim over it,
 * so the crane a player built stands behind the site select they chose it from.
 */
export function spawnScene(world: World): void {
  world.spawn(GroundActor);
  world.spawn(SiteActor);
  world.spawn(CraneActor);
  world.spawn(PartsActor);
}

/**
 * Spawn the screen-space half: the scrim a menu screen reads against, every
 * screen's own readouts, and the flag that says the game is muted.
 *
 * They are spawned in the order they are layered, since the screen pass sorts
 * by layer and then by spawn order (`engine/rendering.md`).
 */
export function spawnReadouts(world: World): void {
  world.spawn(ScrimActor);
  world.spawn(TitleActor);
  world.spawn(HowToActor);
  world.spawn(SelectActor);
  world.spawn(BuildActor);
  world.spawn(ProgramActor);
  world.spawn(RunActor);
  world.spawn(ResultsActor);
  world.spawn(MutedActor);
}

/**
 * Hand every actor that draws the state one reading of it.
 *
 * The game mode calls this from its own tick, which the engine runs after every
 * controller and actor has ticked and before the pipeline draws, so what is on
 * screen is the state as this frame left it. An actor's own `tick` would run
 * before the mode advanced the run and would draw the frame before's crane.
 */
export function refreshViews(world: World): void {
  const frame = viewFrame(world.state as GantryState);
  for (const view of world.ofType(GantryView)) view.refresh(frame);
}
