// Shared client-capability guards for the WebGL scenes (the page backdrop and the
// run-detail voxel viewer). Both gate on the same two questions: can the browser
// paint WebGL at all, and has the user asked for reduced motion? Keeping them in
// one place means every heavy `three` mount answers them identically, so a browser
// without WebGL (or a user who prefers reduced motion) always gets the cheap,
// static fallback instead of a broken or spinning canvas.

/** Whether the user has requested reduced motion. */
export function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}

/** Whether the browser can create a WebGL (or WebGL2) context. */
export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
