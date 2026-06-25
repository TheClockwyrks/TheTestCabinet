import { Suspense, lazy, useEffect, useState } from "react";
import { CssBackdrop } from "./backdrop/CssBackdrop";
import styles from "./Backdrop.module.scss";

// `three` is heavy, so the WebGL scene is split into its own chunk and only
// fetched when we actually mount it.
const SynthwaveScene = lazy(() => import("./backdrop/SynthwaveScene"));

function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2") ?? canvas.getContext("webgl"),
    );
  } catch {
    return false;
  }
}

// Full-viewport atmosphere behind all page content. A cheap background gradient
// always renders for an instant first paint; on top of it we mount the animated
// WebGL synthwave scene when the browser supports WebGL and the user hasn't
// asked for reduced motion. Anyone else gets the static CSS grid fallback, and
// `three` is never downloaded. The CRT scanlines live in the sun shader (see
// `BandedSun`), so they fall only on the sun rather than the whole scene.
export function Backdrop() {
  // Start with the fallback so the first paint never blocks on capability
  // checks; promote to the WebGL scene from an effect (client-only).
  const [useScene, setUseScene] = useState(false);

  useEffect(() => {
    const evaluate = () => {
      setUseScene(!prefersReducedMotion() && supportsWebGL());
    };
    evaluate();
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    motionQuery.addEventListener("change", evaluate);
    return () => motionQuery.removeEventListener("change", evaluate);
  }, []);

  return (
    <div className={styles.backdrop} aria-hidden="true">
      {useScene ? (
        <Suspense fallback={<CssBackdrop />}>
          <SynthwaveScene />
        </Suspense>
      ) : (
        <CssBackdrop />
      )}
    </div>
  );
}
