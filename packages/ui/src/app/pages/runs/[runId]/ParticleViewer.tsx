import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import { ParticleSystemPlayer } from "@test-cabinet/particle-runtime/three";
import { useViewportWheelLock } from "./useViewportWheelLock";

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
 * The center of the field in world coordinates. Emitter positions are absolute
 * field coordinates (an emitter at `[64,64,0]` in a 128×128 field sits at the
 * field's middle), but the camera and orbit target look at the world origin —
 * the field *corner*. Offsetting the point cloud by `-center` puts the field's
 * middle at the origin so the effect is framed centered rather than shoved into a
 * corner and clipped. Shared by the live view and the {@link encodeParticleGif}
 * bake so both frame the effect the same way.
 */
export function fieldCenter(system: ParticleSystem): [number, number, number] {
  return [
    system.field.width / 2,
    system.field.height / 2,
    (system.field.depth ?? 0) / 2,
  ];
}

/**
 * A faint crosshair at the world origin (the field center) that eases in while the
 * camera is being moved and fades out once it settles. A particle effect isn't
 * always on screen — between bursts the field is empty — so an orbit or zoom can
 * leave the reviewer with no fixed reference for where the camera is pointing; the
 * crosshair gives one. Its arms cross all three axes so it reads under a 3D orbit
 * as well as face-on in 2D. It draws over the particles (`depthTest: false`) so a
 * dense burst never hides the reference.
 */
function OriginCrosshair({
  extent,
  active,
}: {
  extent: number;
  active: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.LineBasicMaterial>(null);
  const arm = extent * 0.12;
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    // prettier-ignore
    const points = new Float32Array([
      -arm, 0, 0,  arm, 0, 0,
      0, -arm, 0,  0, arm, 0,
      0, 0, -arm,  0, 0, arm,
    ]);
    g.setAttribute("position", new THREE.BufferAttribute(points, 3));
    return g;
  }, [arm]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Ease the opacity toward the active target each frame so the crosshair doesn't
  // pop; hide the group outright once it's invisible so it costs nothing at rest.
  useFrame(() => {
    const mat = matRef.current;
    const group = groupRef.current;
    if (!mat || !group) return;
    const target = active ? 0.8 : 0;
    mat.opacity += (target - mat.opacity) * 0.18;
    group.visible = mat.opacity > 0.01;
  });

  return (
    <group ref={groupRef} visible={false}>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial
          ref={matRef}
          color="#aeb6c2"
          transparent
          opacity={0}
          depthTest={false}
          depthWrite={false}
        />
      </lineSegments>
    </group>
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
  center,
}: {
  player: ParticleSystemPlayer;
  loop: boolean;
  durationMs: number;
  center: [number, number, number];
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
    if (
      emptiedAt.current >= 0 &&
      elapsed.current - emptiedAt.current > REPLAY_HOLD_MS
    ) {
      player.reset();
      elapsed.current = 0;
      emptiedAt.current = -1;
    }
  });

  // Offset by -center so the field's middle sits at the world origin the camera
  // and orbit target look at (see fieldCenter), rather than the field's corner.
  return (
    <group position={[-center[0], -center[1], -center[2]]}>
      <primitive object={player.points} />
    </group>
  );
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
  const center = useMemo(() => fieldCenter(system), [system]);
  const distance = extent * 1.8;
  // A 2D system reads best face-on; a 3D one from a raised three-quarter angle.
  const cameraPosition: [number, number, number] =
    system.dimensions === 2
      ? [0, 0, distance]
      : [distance * 0.7, distance * 0.5, distance * 0.7];

  // Show the origin crosshair while the camera is being moved, then linger briefly
  // so a series of small wheel/drag nudges doesn't strobe it in and out.
  const [interacting, setInteracting] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const clearHide = useCallback(() => {
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);
  const handleStart = useCallback(() => {
    clearHide();
    setInteracting(true);
  }, [clearHide]);
  const handleEnd = useCallback(() => {
    clearHide();
    hideTimer.current = window.setTimeout(() => setInteracting(false), 600);
  }, [clearHide]);
  useEffect(() => clearHide, [clearHide]);

  // Scrolling over the viewport zooms the camera; stop it from scrolling the page too.
  const containerRef = useViewportWheelLock<HTMLDivElement>(true);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height, borderRadius: 4, overflow: "hidden" }}
    >
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
            center={center}
          />
        ) : null}
        <OriginCrosshair extent={extent} active={interacting} />
        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom
          // A 2D effect is inspected face-on; lock its orbit so it stays planar.
          enableRotate={system.dimensions !== 2}
          onStart={handleStart}
          onEnd={handleEnd}
        />
      </Canvas>
    </div>
  );
}
