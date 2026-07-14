/**
 * Sunfront — entry point.
 *
 * Boots the 3D world: the low oblique command camera, the generated sand terrain
 * (banding, staging-yard panels, the player build grid) and scene lighting, and the
 * GPU-instanced voxel renderer for the rigid unit roster plus the `VoxelRig`
 * singletons for the bases, Reliquaries, extractors, spawners, and the Aegis
 * (specs/assets.md, specs/overview.md). While the asset bundle loads, a title card is
 * shown; once ready, the {@link Game} controller takes over: it runs the full state
 * machine (title / how-to-play / in-match / paused / match-over), draws the HUD overlay,
 * and wires every control (arm + place from the build palette, structure management, the
 * camera, pause, and the F3/F4 toggles), stepping the headless {@link Match} simulation
 * only while a match is live (specs/flow.md).
 */

import { PALETTE, MONO_FONT_STACK } from "./constants";
import { loadAssets } from "./assets";
import { World } from "./render/world";
import { Game } from "./game";

const app = document.getElementById("app")!;

const status = document.createElement("div");
Object.assign(status.style, {
  position: "absolute",
  inset: "0",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  font: `16px ${MONO_FONT_STACK}`,
  color: PALETTE.textSecondary,
  zIndex: "20",
  pointerEvents: "none",
});
status.textContent = "SUNFRONT — loading roster…";
app.appendChild(status);

loadAssets()
  .then((assets) => {
    status.remove();
    const world = new World(app, assets);
    const game = new Game(world, assets);
    game.start();

    // Expose for the headless render/state proofs (screenshotting each screen).
    (window as unknown as { sunfront?: unknown }).sunfront = { world, game };
    console.info(
      `[sunfront] ready: ${assets.units.size} unit types, ${assets.structures.size} structures, ` +
        `${assets.spawners.size} spawners, ${assets.effects.size} effects, aegis ready`,
    );
  })
  .catch((err) => {
    console.error("[sunfront] asset load failed", err);
    status.textContent = "SUNFRONT — asset load failed (see console)";
    status.style.color = PALETTE.invalid;
  });
