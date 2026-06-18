import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { useAppSettings } from "../../store/appSettings";
import { BandedSun } from "./BandedSun";
import { GradientBackground } from "./GradientBackground";
import { GridFloor } from "./GridFloor";
import { readScenePalette } from "./palette";
import { WireframeTerrain } from "./WireframeTerrain";

// The WebGL outrun scene: a scrolling neon grid plane, distant wireframe
// terrain, and an optional banded sun, fogged into the page background. Default
// export so it can be `React.lazy`-loaded — `three` then lands in its own chunk
// instead of the entry bundle. Mounted only when WebGL is available and the
// user hasn't requested reduced motion (see `Backdrop`).
export default function SynthwaveScene() {
  const palette = useMemo(() => readScenePalette(), []);
  const sunEnabled = useAppSettings((s) => s.sunEnabled);

  // Pause rendering while the tab is hidden to avoid burning GPU/battery in the
  // background.
  const [active, setActive] = useState(() => !document.hidden);
  useEffect(() => {
    const onVisibility = () => setActive(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return (
    <Canvas
      aria-hidden="true"
      frameloop={active ? "always" : "never"}
      dpr={[1, 1.5]}
      // Opaque canvas: a transparent one forces the page compositor to
      // alpha-blend this full-viewport layer over the page every frame, which
      // is brutal under software compositing (e.g. Firefox/Linux falling back
      // to software WebRender). Opaque, the canvas is a cheap blit and the
      // scene paints its own background gradient (`GradientBackground`).
      gl={{ antialias: true, alpha: false }}
      camera={{ position: [0, 1.2, 6], fov: 60, near: 0.1, far: 200 }}
      // Tilt the view down a few degrees so the foreground grid fills all the
      // way to the bottom edge instead of fading out into a dark band.
      onCreated={({ camera }) => camera.lookAt(0, -2.5, -26)}
      style={{ position: "absolute", inset: 0 }}
    >
      <fog attach="fog" args={[palette.fog.getHex(), 45, 130]} />
      <GradientBackground
        top={palette.bgTop}
        mid={palette.bgMid}
        bottom={palette.bgBottom}
      />
      <GridFloor near={palette.gridNear} far={palette.gridFar} />
      <WireframeTerrain color={palette.terrain} />
      {sunEnabled && (
        <BandedSun top={palette.sunTop} bottom={palette.sunBottom} />
      )}
    </Canvas>
  );
}
