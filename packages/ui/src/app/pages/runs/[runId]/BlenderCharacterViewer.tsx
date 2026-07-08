import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useAnimations, useGLTF } from "@react-three/drei";
import { Box3, LoopOnce, LoopRepeat, Vector3, type Group } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  AMBIENT_INTENSITY,
  CAMERA_FOV,
  FILL_LIGHT,
  KEY_LIGHT,
  cameraPosition,
  framingFromBounds,
  type Vec3,
} from "./voxelScene";
import { useViewportWheelLock } from "./useViewportWheelLock";
import type { VoxelViewMode } from "./VoxelViewer";

/**
 * The loaded glTF, cloned for this viewer instance and playing the selected clip. A
 * Blender character's animations are baked into the glTF itself (glTF animation
 * channels), so they are driven by a native {@link https://threejs.org | three}
 * `AnimationMixer` (via drei's `useAnimations`) rather than posed from an inline
 * `rig.json` the way the CSG-skinned kinds are.
 *
 * The scene is deep-cloned with `SkeletonUtils.clone` (which rebinds the skeleton) so
 * this instance owns its own graph: a three object can live in only one scene at a
 * time, and the inline and expanded canvases mount simultaneously against the same
 * `useGLTF`-cached scene.
 */
function Character({
  url,
  animationName,
  loop,
}: {
  url: string;
  animationName: string | null;
  loop: boolean;
}) {
  const { scene, animations } = useGLTF(url);
  const cloned = useMemo(() => cloneSkinned(scene) as Group, [scene]);
  const rootRef = useRef<Group>(cloned);
  rootRef.current = cloned;
  const { actions } = useAnimations(animations, rootRef);

  // Frame the character from its rest-pose bounds: the fit distance plus the center
  // to translate to the origin. The glTF is exported in the character's own units
  // and orientation, and its boots sit at y=0, so left un-centered a default
  // origin-height camera looks steeply *up* the body from under the feet — the same
  // recenter-then-place the voxel/skinned viewers do (a `Box3` here rather than a
  // flat positions array). The rest pose is representative, so a played clip's
  // limb-swing doesn't reframe; the sub-1 fill inside `framingFromBounds` reserves
  // the margin that swing needs.
  const { center, distance, far } = useMemo(() => {
    const box = new Box3().setFromObject(cloned);
    const min: Vec3 = [box.min.x, box.min.y, box.min.z];
    const max: Vec3 = [box.max.x, box.max.y, box.max.z];
    return framingFromBounds(min, max);
  }, [cloned]);

  // Place the camera at the raised 3/4 view the rest of the 3D family uses and aim the
  // orbit target at the character (now recentered to the origin), so the first frame
  // looks at the soldier's front rather than up from under its boots.
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as {
    target: Vector3;
    update: () => void;
  } | null;
  useEffect(() => {
    const [cx, cy, cz] = cameraPosition(distance);
    camera.position.set(cx, cy, cz);
    camera.near = 0.1;
    camera.far = far;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, [camera, controls, distance, far]);

  // Play the selected clip (fading the previous one out), configured to loop or to
  // play once and hold its final pose — the `loop` flag the case declares for each
  // required animation. A name with no matching clip in the glTF plays nothing (the
  // model failed to author it; the validator already records that gap).
  useEffect(() => {
    if (!animationName) return;
    const action = actions[animationName];
    if (!action) return;
    action.reset();
    action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.fadeIn(0.25).play();
    return () => {
      action.fadeOut(0.25);
    };
  }, [actions, animationName, loop]);

  return (
    <group position={[-center[0], -center[1], -center[2]]}>
      <primitive object={cloned} />
    </group>
  );
}

/**
 * Interactive 3D view of a produced **Blender character** (`blender-character`): the
 * emitted skinned + animated glTF, loaded whole and played through a native glTF
 * animation player. Recenters the character to the origin and frames it from a raised
 * 3/4 view (the shared {@link framingFromBounds}/{@link cameraPosition}, so it matches
 * the voxel/skinned viewers) then orbits it; the selected animation (or the idle it
 * auto-plays) drives the baked clips.
 *
 * Default export so it can be `React.lazy`-loaded behind a WebGL/reduced-motion gate
 * (see {@link BlenderResultSection}). Mirrors {@link SkinnedVoxelViewer} for the
 * baked-glTF path.
 */
export default function BlenderCharacterViewer({
  url,
  animationName,
  loop,
  mode,
  enableZoom,
  height = 320,
  label,
}: {
  /** Loadable URL of the emitted `character.glb`. */
  url: string;
  /** The clip to play, or null to hold the rest pose. */
  animationName: string | null;
  /** Whether the clip loops (else it plays once and holds its final pose). */
  loop: boolean;
  /** Whether the camera auto-rotates or is a still drag-to-inspect view. */
  mode: VoxelViewMode;
  /** Whether scroll-to-zoom is enabled. Off by default (inline views disable it). */
  enableZoom?: boolean;
  /** Canvas height in px. */
  height?: number;
  /** Accessible name for the canvas. */
  label: string;
}) {
  // When zoom is on, keep the wheel from scrolling the page while it zooms the camera.
  const containerRef = useViewportWheelLock<HTMLDivElement>(
    enableZoom ?? false,
  );

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height, borderRadius: 4, overflow: "hidden" }}
    >
      <Canvas
        aria-label={label}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
        camera={{ fov: CAMERA_FOV, near: 0.1, far: 2000 }}
      >
        <ambientLight intensity={AMBIENT_INTENSITY} />
        <directionalLight
          position={KEY_LIGHT.position}
          intensity={KEY_LIGHT.intensity}
        />
        <directionalLight
          position={FILL_LIGHT.position}
          intensity={FILL_LIGHT.intensity}
        />
        <Character url={url} animationName={animationName} loop={loop} />
        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom={enableZoom ?? false}
          autoRotate={mode === "auto-rotate"}
          autoRotateSpeed={1.5}
        />
      </Canvas>
    </div>
  );
}
