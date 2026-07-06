import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import { ParticleSystemPlayer } from "@test-cabinet/particle-runtime/three";

// How the effect blends: additive reads right for fire/energy/spark VFX, normal for
// smoke/debris. The reviewer picks it; the default follows the fiery common case.
export type ParticleBlend = "additive" | "normal";

/** The largest field extent, the basis for camera framing and default pixel scale. */
function fieldExtent(system: ParticleSystem): number {
  return Math.max(
    system.field.width,
    system.field.height,
    system.field.depth ?? 0,
    1,
  );
}

/**
 * The scene contents inside the {@link Canvas}: the simulated point cloud plus a
 * frame loop that steps the simulation. A one-shot effect (`loop === false`) replays
 * itself: once the last particle has died and a short tail has elapsed, the simulator
 * is reset so the reviewer sees the effect fire again rather than an empty field.
 */
function ParticleScene({
  player,
  loop,
  durationMs,
}: {
  player: ParticleSystemPlayer;
  loop: boolean;
  durationMs: number;
}) {
  // Time (ms) since the current one-shot play emptied out; -1 while still active.
  const emptiedAt = useRef(-1);
  const elapsed = useRef(0);
  // How long to hold on the emptied field before replaying a one-shot.
  const REPLAY_HOLD_MS = 600;

  useFrame((_, dt) => {
    const dtMs = Math.min(dt, 0.05) * 1000; // clamp long frames (tab switch)
    player.update(dt);
    elapsed.current += dtMs;
    if (loop) return;
    // A one-shot has finished once it is past its authored duration and every
    // emitted particle has died. Hold briefly, then reset to replay.
    const done =
      elapsed.current > durationMs && player.simulator.liveCount === 0;
    if (done && emptiedAt.current < 0) {
      emptiedAt.current = elapsed.current;
    }
    if (emptiedAt.current >= 0 && elapsed.current - emptiedAt.current > REPLAY_HOLD_MS) {
      player.reset();
      elapsed.current = 0;
      emptiedAt.current = -1;
    }
  });

  return <primitive object={player.points} />;
}

/**
 * Interactive live view of a produced particle system. Builds a
 * {@link ParticleSystemPlayer} from the run's `system.json` and **simulates it
 * live** in an R3F {@link Canvas} — a running particle editor, not a replayed clip —
 * so the character of the effect (an explosion, a plume, a muzzle flash) is reviewed
 * the way it will actually play. A looping system loops; a one-shot replays itself.
 *
 * Default export so it can be `React.lazy`-loaded — `three`, `@react-three/drei`, and
 * the particle runtime then land in their own chunk instead of the entry bundle. The
 * caller ({@link ParticleResultSection}) gates the mount on WebGL support and
 * reduced-motion, showing the preview GIF (or a static message) otherwise.
 */
export default function ParticleViewer({
  system,
  blend,
  height = 320,
  label,
}: {
  /** The authored system to simulate (the decoded `system.json`). */
  system: ParticleSystem;
  /** How the billboards blend. */
  blend: ParticleBlend;
  /** Canvas height in px. */
  height?: number;
  /** Accessible name for the canvas. */
  label: string;
}) {
  // Build the player inside an effect (not `useMemo`) so its creation and disposal
  // are balanced under StrictMode's setup→cleanup→setup — mirroring VoxelViewer.
  const [player, setPlayer] = useState<ParticleSystemPlayer | null>(null);
  useEffect(() => {
    const built = new ParticleSystemPlayer(system, {
      blending:
        blend === "normal" ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    setPlayer(built);
    return () => built.dispose();
  }, [system, blend]);

  const extent = useMemo(() => fieldExtent(system), [system]);
  const distance = extent * 1.8;
  // A 2D system reads best face-on; a 3D one from a raised three-quarter angle.
  const cameraPosition: [number, number, number] =
    system.dimensions === 2
      ? [0, 0, distance]
      : [distance * 0.7, distance * 0.5, distance * 0.7];

  return (
    <div style={{ width: "100%", height, borderRadius: 4, overflow: "hidden" }}>
      <Canvas
        aria-label={label}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
        camera={{
          position: cameraPosition,
          fov: 45,
          near: 0.1,
          far: distance * 12 + 100,
        }}
      >
        {player ? (
          <ParticleScene
            player={player}
            loop={system.loop}
            durationMs={system.durationMs}
          />
        ) : null}
        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom
          // A 2D effect is inspected face-on; lock its orbit so it stays planar.
          enableRotate={system.dimensions !== 2}
        />
      </Canvas>
    </div>
  );
}
