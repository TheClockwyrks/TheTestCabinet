/**
 * Sunfront — entry point.
 *
 * Phase 3 boots the 3D world: the low oblique command camera, the generated sand
 * terrain (banding, staging-yard panels, the player build grid) and scene lighting,
 * and the GPU-instanced voxel renderer for the rigid unit roster plus the `VoxelRig`
 * singletons for the bases, Reliquaries, extractors, spawners, and the Aegis
 * (specs/assets.md, specs/overview.md). While the asset bundle loads, a title card is
 * shown; once ready, a TEMPORARY proof scene (see `demo.ts`) spreads a rank of unit
 * types and structures across the corridor and animates them through the camera so the
 * relative scale, team tint, animation, and the F3/F4 overlays can be verified. Later
 * phases replace the demo with the real simulation, economy, fog, HUD, and AI.
 */

import { PALETTE, MONO_FONT_STACK } from "./constants";
import { loadAssets } from "./assets";
import { World } from "./render/world";
import { DemoScene } from "./demo";

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
    const demo = new DemoScene(world, assets);

    let last = performance.now();
    function frame(now: number): void {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      demo.update(dt);
      world.render(dt);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // Expose for the headless render proof (screenshotting the demo state).
    (window as unknown as { sunfront?: unknown }).sunfront = { world, demo };
    console.info(
      `[sunfront] world up: ${assets.units.size} unit types, ${assets.structures.size} structures, ` +
        `${assets.spawners.size} spawners, ${assets.effects.size} effects, aegis ready`,
    );
  })
  .catch((err) => {
    console.error("[sunfront] asset load failed", err);
    status.textContent = "SUNFRONT — asset load failed (see console)";
    status.style.color = PALETTE.invalid;
  });
