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

/**
 * Whether the browser can create a WebGL (or WebGL2) context.
 *
 * The probe's own context is released as soon as it has answered. A browser keeps
 * only a handful of live contexts and drops the oldest past that, so a page asking
 * once per viewer — a list of previews — would otherwise blank its own viewers.
 */
export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
