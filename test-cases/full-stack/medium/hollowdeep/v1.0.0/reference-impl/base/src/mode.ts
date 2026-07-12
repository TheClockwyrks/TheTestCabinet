// Hollowdeep — the colony start this build plays (specs/mode.md).
//
// THE START IS ISOLATED TO THIS CONFIG: the starting crew size, the finite pocket of
// breathable oxygen filling the opening cavern, and the modest starting stock of material
// on hand. Everything else — the tile world, the gas simulation, power, the delvers and
// their jobs, the refine/build/food economy, the camera/tools/speed controls, and the
// survival flow, cycles, scoring, states, and HUD — is common (the specs it lists). The
// standard survival start `NEW COLONY` uses every system with no overrides.

import { DELVER_COUNT, START_CO2, START_OXYGEN } from "./constants";

export interface ColonyMode {
  slug: string;
  menuLabel: string; // the main-menu entry for this start (specs/mode.md)
  tagline: string;
  delverCount: number; // starting crew (specs/delvers.md)
  startMaterial: number; // refined material on hand at the start (specs/economy.md)
  startOre: number;
  startFood: number;
  startOxygen: number; // oxygen seeded into each opening-cavern open tile (specs/gas.md)
  startCo2: number; // trace CO2 at the start
}

export const MODE: ColonyMode = {
  slug: "new-colony",
  menuLabel: "NEW COLONY",
  tagline: "SEAL THE DEEP. KEEP THE CREW BREATHING.",
  delverCount: DELVER_COUNT,
  startMaterial: 30,
  startOre: 0,
  startFood: 8,
  startOxygen: START_OXYGEN,
  startCo2: START_CO2,
};
