// assets/burst-system-produced — the destruction burst is a produced particle
// system the runtime accepts.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` puts the destruction burst
// at `assets/particles/burst.json`, "produced with `particle-2d` as a
// `system.json`", fired "at the arc center of a destroyed target", and played
// "through `@clockwyrks/particle-runtime`, an installed dependency imported
// by its bare name", where "a player is constructed over a parsed system" and
// "the package's own types are the authoritative API". So the file exists, it
// parses as JSON, and the runtime's own simulator constructs over it and plays
// one full duration without throwing — which is what a system the runtime
// accepts is. No schema is re-stated here; the runtime is the authority (see
// `assets/particles.ts`).
//
// WHAT IT DELIBERATELY DOES NOT READ. Whether the build FIRES the burst on a
// destruction, and through the runtime's `./canvas` binding, belongs to the
// effect's own points and `assets/particles-played-through-runtime`; whether
// the burst is "authored radially symmetric" and reads well is the art bar and
// the presentation domain's aesthetic rating.
//
// THE EVIDENCE. This point drives no game, so its declared still is a picture
// of the file: the system simulated by the runtime's own simulator and its
// fullest frame plotted.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import { captureStill, openHarness, type Harness } from "../harness";
import { PARTICLE_FILES, readSystem, showParticleSystem } from "./particles";

/** The path `specs/assets.md` fixes for the destruction burst. */
const FILE = PARTICLE_FILES.burst;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ships a burst system the particle runtime accepts", async () => {
  const { system, reason, particles } = await readSystem(FILE);
  showParticleSystem(h, FILE, particles);
  captureStill(h, "system");

  if (system === null) {
    fail(
      `${FILE} parsing as a particle system @clockwyrks/particle-runtime accepts`,
      reason,
    );
  }
});
