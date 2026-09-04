// Volute — the level registry's two entries, keyed by the names `WORLDS` fixes:
// `title`, the level the engine opens first, and `hall`, the level a run plays
// in.
//
// Both place the SAME bodies. The title screen shows the hall behind it, dimmed
// by its own scrim, so the plate, the intake, the injector and the chrome are
// furniture of both levels; the cores and the cores in flight are not furniture
// at all — they arrive and leave with the run, so the game mode spawns them.
//
// The produced files are loaded once, by the game instance's `initialize`, since
// both levels draw and play the same set; neither level has a `load` of its own.

import type { ActorSpec, LevelDefinition } from "@test-cabinet/structured-2d";
import { Injector, Intake } from "./actors";
import { INTAKE } from "./channel";
import { TAGS } from "./constants";
import { Effects } from "./fx";
import { HallMode } from "./hall-mode";
import { Hud, Screens } from "./hud";
import { ChannelPlate, Sightline } from "./scenery";
import { TitleMode } from "./title-mode";

/** The hall itself: the channel, the intake, the injector, and the chrome. */
function furniture(): ActorSpec[] {
  return [
    { type: ChannelPlate },
    {
      type: Intake,
      transform: { x: INTAKE.x, y: INTAKE.y },
      tags: [TAGS.intake],
    },
    { type: Injector, tags: [TAGS.injector] },
    { type: Sightline },
    { type: Effects },
    { type: Hud },
    { type: Screens },
  ];
}

/** The front door. */
export const title: LevelDefinition = {
  mode: TitleMode,
  actors: furniture(),
};

/** The level a run plays in. */
export const hall: LevelDefinition = {
  mode: HallMode,
  actors: furniture(),
};
