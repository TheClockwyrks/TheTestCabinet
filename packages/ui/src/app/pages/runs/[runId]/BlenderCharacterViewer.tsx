import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useAnimations, useGLTF } from "@react-three/drei";
import {
  Box3,
  LoopOnce,
  LoopRepeat,
  Quaternion,
  Vector3,
  type AnimationClip,
  type Group,
  type Object3D,
} from "three";
import type { AxisSpec, JointSpec } from "@test-cabinet/run-record";
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

/** Stable empty defaults, so a viewer with no procedural interface (the common case, and
 * every prop) never re-runs the DOF effects on a fresh literal each render. */
const EMPTY_DOFS: JointSpec[] = [];
const EMPTY_DOF_VALUES: Record<string, number> = {};

/** The unit vector for a caller DOF's axis, in the emitted glTF frame (Y-up). A DOF is
 * applied about the driven node's **local** axis, so an off-upright mount still turns
 * correctly. */
const AXIS_UNIT: Record<AxisSpec, Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
};

/** One caller DOF resolved against the loaded scene: the node it drives, that node's
 * authored rest transform (captured once), and the joint contract (axis/kind/rest). */
interface ResolvedDof {
  node: Object3D;
  baseQuat: Quaternion;
  basePos: Vector3;
  joint: JointSpec;
}

/** Find the node a caller DOF drives: the one whose `extras.tcab_joint` name matches
 * (surfaced by the glTF loader as `userData.tcab_joint`), falling back to a node named
 * for the DOF. Returns null when the model exposed no matching node (the validator has
 * already recorded that contract gap). */
function findDofNode(root: Object3D, joint: JointSpec): Object3D | null {
  let byTag: Object3D | null = null;
  let byName: Object3D | null = null;
  root.traverse((obj) => {
    const tag = (obj.userData as { tcab_joint?: { name?: string } } | undefined)
      ?.tcab_joint;
    if (tag?.name === joint.name && !byTag) byTag = obj;
    if (obj.name === joint.name && !byName) byName = obj;
  });
  return byTag ?? byName;
}

/**
 * The scene contents inside the {@link Canvas}: the cloned character (recentered to the
 * origin) plus its native glTF animation player. Kept as a child component so it can
 * call the R3F hooks (`useAnimations`/`useThree`), which only work inside the canvas.
 *
 * A Blender character's animations are baked into the glTF itself (glTF animation
 * channels), so they are driven by a native {@link https://threejs.org | three}
 * `AnimationMixer` (via drei's `useAnimations`) rather than posed from an inline
 * `rig.json` the way the CSG-skinned kinds are. The clone (rebinding the skeleton) is
 * built by the parent, before the canvas mounts.
 */
function Character({
  cloned,
  animations,
  center,
  distance,
  far,
  animationName,
  loop,
  callerDofs,
  dofValues,
}: {
  cloned: Group;
  animations: AnimationClip[];
  center: Vec3;
  distance: number;
  far: number;
  animationName: string | null;
  loop: boolean;
  callerDofs: JointSpec[];
  dofValues: Record<string, number>;
}) {
  const rootRef = useRef<Group>(cloned);
  rootRef.current = cloned;
  const { actions } = useAnimations(animations, rootRef);

  // Resolve each caller DOF to the node it drives and snapshot that node's authored rest
  // transform once, so the runtime value is applied as a delta from rest. Rebuilt only
  // when the model (clone) or the DOF set changes.
  const resolvedDofs = useMemo<ResolvedDof[]>(() => {
    return callerDofs
      .map((joint) => {
        const node = findDofNode(cloned, joint);
        if (!node) return null;
        return {
          node,
          baseQuat: node.quaternion.clone(),
          basePos: node.position.clone(),
          joint,
        } satisfies ResolvedDof;
      })
      .filter((d): d is ResolvedDof => d !== null);
  }, [cloned, callerDofs]);

  // Drive the caller DOFs every frame, AFTER the animation mixer has posed the clip — a
  // game aiming a turret sets these from its own state, exactly this way. A caller DOF
  // node is not touched by the required clips (deploy/fire/stow don't move the yaw), so
  // the two never fight. The value is the absolute DOF value; the delta from `rest` is
  // applied about the node's LOCAL axis (rotation) or along it (translation).
  useFrame(() => {
    for (const { node, baseQuat, basePos, joint } of resolvedDofs) {
      const value = dofValues[joint.name] ?? joint.rest;
      const delta = value - joint.rest;
      const axis = AXIS_UNIT[joint.axis];
      if (joint.kind === "rotation") {
        node.quaternion
          .copy(baseQuat)
          .multiply(new Quaternion().setFromAxisAngle(axis, delta));
      } else {
        node.position
          .copy(basePos)
          .add(axis.clone().multiplyScalar(delta).applyQuaternion(baseQuat));
      }
    }
  });

  // Place the camera at the raised 3/4 view the rest of the 3D family uses and aim the
  // orbit target at the character (now recentered to the origin), so the first frame
  // looks at the soldier's front rather than up from under its boots. The `Canvas`
  // already framed the same distance/far on mount; this re-aims the controls' target.
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
 * Interactive 3D view of a produced **Blender** asset (`blender-character`/`blender-prop`/
 * `blender-mechanism`): the emitted native glTF, loaded whole and played through a native
 * glTF animation player. Serves all three members — a skinned character, a rigidly-
 * articulated mechanism (node-hierarchy clips), and a static prop (no clips: `mode`
 * `auto-rotate` turntables it). Recenters the model to the origin and frames it from a
 * raised 3/4 view (the shared {@link framingFromBounds}/{@link cameraPosition}, so it
 * matches the voxel/skinned viewers) then orbits it; the selected animation (or the idle
 * it auto-plays) drives the baked clips. `SkeletonUtils.clone` deep-clones a skinned or a
 * plain object graph alike, so the same path serves the unrigged prop.
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
  callerDofs = EMPTY_DOFS,
  dofValues = EMPTY_DOF_VALUES,
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
  /** The case's required **caller DOFs** (the game-facing procedural joints), driven
   * live from {@link dofValues}. Empty for a prop / a case with no procedural interface. */
  callerDofs?: JointSpec[];
  /** The current value of each caller DOF by name (radians for a rotation, world units
   * for a translation). Missing entries hold at the joint's `rest`. */
  dofValues?: Record<string, number>;
}) {
  // When zoom is on, keep the wheel from scrolling the page while it zooms the camera.
  const containerRef = useViewportWheelLock<HTMLDivElement>(
    enableZoom ?? false,
  );

  // Load and decode the glTF *before* the Canvas mounts: `useGLTF` suspends here, at the
  // top of the component, so on a cache miss the whole viewer unwinds to the outer
  // <Suspense> (the PNG fallback in BlenderResultSection) with no <Canvas> — and so no
  // WebGL context — ever created. Loading inside the Canvas (a suspending Canvas child)
  // instead mounts the renderer, unwinds past it to that same outer boundary, then
  // remounts a *fresh* renderer when the model resolves; that create→lose→recreate
  // churn is what blanks the view a beat after it appears and spams "WebGL context
  // lost" in the console. The voxel/skinned siblings likewise resolve their geometry
  // before their Canvas mounts (they receive it as a prop).
  const { scene, animations } = useGLTF(url);

  // Deep-clone with `SkeletonUtils.clone` (which rebinds the skeleton) so this instance
  // owns its own graph: a three object can live in only one scene at a time, and the
  // inline and expanded canvases mount simultaneously against the same `useGLTF`-cached
  // scene. Not disposed on unmount — the cache owns the source graph; this clone is
  // plain GC.
  const cloned = useMemo(() => cloneSkinned(scene) as Group, [scene]);

  // Frame the character from its rest-pose bounds: the fit distance plus the center to
  // translate to the origin. The glTF is exported in the character's own units and
  // orientation, and its boots sit at y=0, so left un-centered a default origin-height
  // camera looks steeply *up* the body from under the feet — the same recenter-then-
  // place the voxel/skinned viewers do (a `Box3` here rather than a flat positions
  // array). The rest pose is representative, so a played clip's limb-swing doesn't
  // reframe; the sub-1 fill inside `framingFromBounds` reserves the margin swing needs.
  const { center, distance, far } = useMemo(() => {
    const box = new Box3().setFromObject(cloned);
    const min: Vec3 = [box.min.x, box.min.y, box.min.z];
    const max: Vec3 = [box.max.x, box.max.y, box.max.z];
    return framingFromBounds(min, max);
  }, [cloned]);

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
          position: cameraPosition(distance),
          fov: CAMERA_FOV,
          near: 0.1,
          far,
        }}
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
        <Character
          cloned={cloned}
          animations={animations}
          center={center}
          distance={distance}
          far={far}
          animationName={animationName}
          loop={loop}
          callerDofs={callerDofs}
          dofValues={dofValues}
        />
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
