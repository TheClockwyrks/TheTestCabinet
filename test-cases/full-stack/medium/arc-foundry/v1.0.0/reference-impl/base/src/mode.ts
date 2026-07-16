// Arc Foundry — the campaign start this build plays (specs/mode.md).
//
// There is exactly one campaign start — SALVAGE, the standard campaign. It fixes the
// opening resources; the DIFFICULTY (wave count + enemy toughness) is chosen from an
// in-game menu after the map select, NOT a variant (specs/modes.md). Everything else —
// the board and its three maps, the components and quality ladder, the scrap-press build
// loop, the Load and the Dynamo, the economy, states, and HUD — is common (specs/mode.md,
// and specs/board/enemies/towers/build/controls/flow.md).

import { START_CHARGE, START_INTEGRITY } from "./constants";

export interface Campaign {
  slug: string;
  menuLabel: string; // the main-menu entry for this start (specs/mode.md)
  tagline: string;
  startCharge: number;
  startIntegrity: number;
}

export const CAMPAIGN: Campaign = {
  slug: "salvage",
  menuLabel: "SALVAGE",
  tagline: "SALVAGE THE SURGE",
  startCharge: START_CHARGE,
  startIntegrity: START_INTEGRITY,
};
