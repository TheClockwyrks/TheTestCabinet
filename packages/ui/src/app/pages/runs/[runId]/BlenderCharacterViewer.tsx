import { useEffect, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, OrbitControls, useAnimations, useGLTF } from "@react-three/drei";
import { LoopOnce, LoopRepeat, type Group } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  AMBIENT_INTENSITY,
  CAMERA_FOV,
  FILL_LIGHT,
  KEY_LIGHT,
} from "./voxelScene";
import { useViewportWheelLock } from "./useViewportWheelLock";
import type { VoxelViewMode } from "./VoxelViewer";

/**
 * The margin the auto-framing leaves around the character's rest-pose bounds. Held
 * above 1 so an animation's limb-swing — a raised knee, a recoiling shoulder, a
 * collapsing death — stays inside the frame rather than clipping the viewport edge,
 * mirroring the sub-1 fill the voxel framing reserves.
 */
const FRAME_MARGIN = 1.25;

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

  return <primitive object={cloned} />;
}

/**
 * Interactive 3D view of a produced **Blender character** (`blender-character`): the
 * emitted skinned + animated glTF, loaded whole and played through a native glTF
 * animation player. Auto-frames the character with drei's `<Bounds>` and orbits it;
 * the selected animation (or the idle it auto-plays) drives the baked clips.
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
  const containerRef = useViewportWheelLock<HTMLDivElement>(enableZoom ?? false);

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
        {/* Fit the character to the frame from its bounds (the glTF is exported in the
            character's own units and orientation), refitting if the viewport resizes. */}
        <Bounds fit clip observe margin={FRAME_MARGIN}>
          <Character url={url} animationName={animationName} loop={loop} />
        </Bounds>
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
