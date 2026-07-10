/**
 * Sunfront — entry point.
 *
 * Boots the 3D world: the low oblique command camera, the generated sand terrain
 * (banding, staging-yard panels, the player build grid) and scene lighting, and the
 * GPU-instanced voxel renderer for the rigid unit roster plus the `VoxelRig`
 * singletons for the bases, Reliquaries, extractors, spawners, and the Aegis
 * (specs/assets.md, specs/overview.md). While the asset bundle loads, a title card is
 * shown; once ready, the headless {@link Match} steps the real simulation (economy,
 * waves, movement, combat, the Reliquary and its Aegis — `sim/world.ts`) and feeds this
 * frame's state to the renderer, so units actually spawn, march, fight, and die and the
 * front line drifts. Later phases add fog, the HUD, player building, and the AI.
 */

import { PALETTE, MONO_FONT_STACK } from "./constants";
import { loadAssets } from "./assets";
import { World } from "./render/world";
import { Match } from "./match";

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
    const match = new Match(world, assets);

    let last = performance.now();
    function frame(now: number): void {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      match.update(dt);
      world.render(dt);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // Expose for the headless render proof (screenshotting a live match frame).
    (window as unknown as { sunfront?: unknown }).sunfront = { world, match };
    console.info(
      `[sunfront] match up: ${assets.units.size} unit types, ${assets.structures.size} structures, ` +
        `${assets.spawners.size} spawners, ${assets.effects.size} effects, aegis ready`,
    );
  })
  .catch((err) => {
    console.error("[sunfront] asset load failed", err);
    status.textContent = "SUNFRONT — asset load failed (see console)";
    status.style.color = PALETTE.invalid;
  });
