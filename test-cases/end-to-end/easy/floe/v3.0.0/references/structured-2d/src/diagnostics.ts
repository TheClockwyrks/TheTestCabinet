// Floe — what the debug overlay reports.
//
// `specs/instrumentation.md` lists the facts the overlay shows and asks for each
// source to be a pure read, so watching the panel leaves the game as it is. The
// engine draws the panel and owns the backtick key that toggles it
// (engine/diagnostics.md); this file is Floe's whole part in it.
//
// The sources go on the WORLD's registry rather than the instance's, because
// every value they read — the game state and the strait's actors — belongs to the
// world and is rebuilt with it (engine/diagnostics.md). Each closes over the
// world it was registered for, so the panel reports the frame being drawn.

import type { World } from "@clockwyrks/structured-2d";
import { TOTAL_LEVELS } from "./constants";
import { bearsOf, critterOf, floesOf, vehiclesOf } from "./bodies";
import { critterCol, critterFooting, critterRow } from "./entities";
import { bearSwimming } from "./hunter";
import { floeState } from "./game";

/** A number as a short line of the panel. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Name every value the overlay shows, in the order it reads them. */
export function registerDiagnostics(world: World): void {
  const register = world.diagnostics.register.bind(world.diagnostics);

  register("screen", () => {
    const state = floeState(world);
    return `${state.screen}/${state.phase}`;
  });
  register("level", () => {
    const state = floeState(world);
    return `${state.level}/${TOTAL_LEVELS} reached ${state.reachedLevel}`;
  });
  register("lives", () => floeState(world).lives);
  register("score", () => floeState(world).score);
  register("timer", () => round(floeState(world).timer));
  register("critter", () => {
    const critter = critterOf(world);
    if (!critter.present) return "off the strait";
    return `tile ${critterCol(critter)},${critterRow(critter)} at ${round(
      critter.transform.x,
    )},${round(critter.transform.y)} facing ${critter.facing} on ${critterFooting(
      world,
      critter,
    )}`;
  });
  register("bears", () => {
    const bears = bearsOf(world);
    if (bears.length === 0) return "none";
    return bears
      .map(
        (bear) =>
          `#${bear.id} tile ${bear.col},${bear.row} at ${round(
            bear.transform.x,
          )},${round(bear.transform.y)} facing ${bear.facing}${
            bearSwimming(world, bear) ? " swimming" : ""
          } hunting ${bear.target.col},${bear.target.row}`,
      )
      .join("  |  ");
  });
  register(
    "traffic",
    () =>
      `${vehiclesOf(world).length} vehicles, ${floesOf(world).length} floes`,
  );
  register("bays", () =>
    floeState(world)
      .bays.map((filled) => (filled ? "#" : "."))
      .join(""),
  );
}
