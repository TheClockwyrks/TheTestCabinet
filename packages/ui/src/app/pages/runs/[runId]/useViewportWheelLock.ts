import { useEffect, useRef } from "react";

/**
 * Keep the mouse wheel from scrolling the page while the pointer is over a 3D
 * viewport whose {@link OrbitControls} consumes the wheel to zoom the camera.
 *
 * R3F/drei's own wheel listener zooms the camera but does not reliably stop the
 * page from *also* scrolling underneath it, so scrolling over the viewport both
 * zooms the camera and scrolls the page. We attach our own **non-passive** wheel
 * listener that calls `preventDefault()`: the page stays put and only the camera
 * zooms. (React's synthetic `onWheel` is registered passively and can't
 * `preventDefault`, so the listener must be attached natively.)
 *
 * The listener runs in the capture phase so it cancels the page scroll even if
 * OrbitControls' own inner handler stops the event from bubbling. `preventDefault`
 * only suppresses the browser's scroll — the event still reaches the controls, so
 * the camera zooms as before.
 *
 * Returns a ref to put on the viewport's container element. Pass `enabled: false`
 * to leave page scroll alone — e.g. an inline view with zoom disabled, where the
 * wheel does nothing and should scroll the surrounding gallery as usual.
 */
export function useViewportWheelLock<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const onWheel = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, [enabled]);
  return ref;
}
