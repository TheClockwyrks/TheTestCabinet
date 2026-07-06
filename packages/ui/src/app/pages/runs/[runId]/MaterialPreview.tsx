import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { MaterialMapView } from "../../../data/galleryContext";

// Which glTF-style PBR channel each declared map name drives on the standard
// material. Names outside this map (e.g. `ambient-occlusion`) are shown per-map but
// not bound here, keeping the preview to the channels three renders natively.
const CHANNEL_BY_NAME: Record<
  string,
  "map" | "normalMap" | "roughnessMap" | "metalnessMap" | "aoMap"
> = {
  "base-color": "map",
  albedo: "map",
  normal: "normalMap",
  roughness: "roughnessMap",
  metallic: "metalnessMap",
  metalness: "metalnessMap",
  "ambient-occlusion": "aoMap",
  ao: "aoMap",
};

/** The lit test surface: a sphere carrying the assembled material, slowly rotating so
 * the reviewer sees how the material catches light across curvature. */
function MaterialSphere({ material }: { material: THREE.Material }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.4;
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[1, 64, 64]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

/**
 * A lit 3D preview of a produced PBR material applied to a test surface — the
 * client-side stand-in for the `pbr` tool's rendered preview, so a `material` run is
 * judged as it will read on a mesh. The declared maps are loaded as textures and
 * bound to a {@link THREE.MeshStandardMaterial}; each wraps and repeats so the tiling
 * shows across the surface.
 *
 * Default export so it can be `React.lazy`-loaded — `three` and the fiber/drei
 * bindings land in their own chunk. The caller gates the mount on WebGL support.
 */
export default function MaterialPreview({
  maps,
  height = 320,
  label,
}: {
  /** The per-map results with resolved image URLs (unservable maps are skipped). */
  maps: MaterialMapView[];
  /** Canvas height in px. */
  height?: number;
  /** Accessible name for the canvas. */
  label: string;
}) {
  const [material, setMaterial] = useState<THREE.MeshStandardMaterial | null>(
    null,
  );

  useEffect(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.0,
    });
    const loader = new THREE.TextureLoader();
    const textures: THREE.Texture[] = [];
    for (const map of maps) {
      const channel = CHANNEL_BY_NAME[map.name];
      if (!channel || !map.imageUrl) continue;
      const texture = loader.load(map.imageUrl);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(2, 2);
      // A color map is authored in sRGB; the data maps stay linear.
      if (channel === "map") texture.colorSpace = THREE.SRGBColorSpace;
      mat[channel] = texture;
      textures.push(texture);
    }
    mat.needsUpdate = true;
    setMaterial(mat);
    return () => {
      for (const t of textures) t.dispose();
      mat.dispose();
    };
  }, [maps]);

  return (
    <div style={{ width: "100%", height, borderRadius: 4, overflow: "hidden" }}>
      <Canvas
        aria-label={label}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
        camera={{ position: [0, 0, 3], fov: 40, near: 0.1, far: 100 }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 4, 5]} intensity={1.2} />
        <directionalLight position={[-3, -1, -2]} intensity={0.4} />
        {material ? <MaterialSphere material={material} /> : null}
        <OrbitControls makeDefault enablePan={false} enableZoom />
      </Canvas>
    </div>
  );
}
