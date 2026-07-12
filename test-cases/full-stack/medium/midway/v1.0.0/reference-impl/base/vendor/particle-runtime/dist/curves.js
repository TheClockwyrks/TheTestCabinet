/**
 * Per-particle curve and gradient sampling — the browser port of the Rust
 * `particle-core` `system.rs` helpers, so a runtime play reads the same as the binary's
 * preview.
 *
 * A particle's size and opacity are each a {@link Curve} (`from → to` with an
 * {@link InterpSpec} easing) over its normalized life `[0, 1]`; its color is a keyed
 * `#rrggbb` gradient over the same life. The eases mirror the CSS timing curves the
 * `model-core` F-curve sampler uses.
 */
/** Clamp `v` into `[lo, hi]`. */
function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}
/**
 * The eased fraction `[0, 1]` an {@link InterpSpec} maps a normalized input `s` to.
 * `constant` steps at the end; `bezier` reads as a smoothstep; the `ease-*` presets are
 * the CSS `cubic-bezier` timing curves.
 */
export function easeFraction(interp, s) {
    const t = clamp(s, 0, 1);
    switch (interp) {
        case "constant":
            return t >= 1 ? 1 : 0;
        case "linear":
            return t;
        case "bezier":
            return t * t * (3 - 2 * t);
        case "ease-in":
            return cubicBezierY(0.42, 0.0, 1.0, 1.0, t);
        case "ease-out":
            return cubicBezierY(0.0, 0.0, 0.58, 1.0, t);
        case "ease-in-out":
            return cubicBezierY(0.42, 0.0, 0.58, 1.0, t);
        default:
            return t;
    }
}
/** Sample a {@link Curve} at normalized life `t` (clamped to `[0, 1]`). */
export function sampleCurve(curve, t) {
    return curve.from + (curve.to - curve.from) * easeFraction(curve.interp, t);
}
/** One coordinate of a cubic Bézier at parameter `u ∈ [0, 1]`, endpoints at 0 and 1. */
function cubic(p1, p2, u) {
    const v = 1 - u;
    return 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u;
}
/**
 * The `y` of a CSS-style cubic-bezier timing curve `(x1, y1, x2, y2)` at input `x`:
 * solve `bezierX(u) = x` by bisection (monotonic across a timing curve), then take
 * `bezierY(u)`.
 */
function cubicBezierY(x1, y1, x2, y2, x) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (cubic(x1, x2, mid) < x)
            lo = mid;
        else
            hi = mid;
    }
    return cubic(y1, y2, (lo + hi) / 2);
}
/** An opaque `#rrggbb` string as linear `0..1` RGB (the render convention). */
export function hexToLinear(hex) {
    const h = hex.startsWith("#") ? hex.slice(1) : hex;
    if (h.length !== 6)
        return [1, 1, 1];
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b))
        return [1, 1, 1];
    return [r / 255, g / 255, b / 255];
}
/**
 * Sample a keyed color gradient at normalized life `t`, lerping between the two
 * bracketing stops. An empty gradient is white; before the first / after the last stop
 * clamps. Stops are expected ordered by {@link ColorStop.at}.
 */
export function sampleGradient(stops, t) {
    if (stops.length === 0)
        return [1, 1, 1];
    const first = stops[0];
    if (stops.length === 1)
        return hexToLinear(first.color);
    const last = stops[stops.length - 1];
    if (t <= first.at)
        return hexToLinear(first.color);
    if (t >= last.at)
        return hexToLinear(last.color);
    for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i];
        const b = stops[i + 1];
        if (t >= a.at && t <= b.at) {
            const span = Math.max(b.at - a.at, Number.EPSILON);
            const f = (t - a.at) / span;
            const ca = hexToLinear(a.color);
            const cb = hexToLinear(b.color);
            return [
                ca[0] + (cb[0] - ca[0]) * f,
                ca[1] + (cb[1] - ca[1]) * f,
                ca[2] + (cb[2] - ca[2]) * f,
            ];
        }
    }
    return hexToLinear(last.color);
}
/** The size factor at normalized life `t` (default `1` when no curve is set). */
export function sizeAt(curve, t) {
    return curve ? sampleCurve(curve, t) : 1;
}
/** The opacity at normalized life `t` (default fully opaque), clamped to `[0, 1]`. */
export function opacityAt(curve, t) {
    return clamp(curve ? sampleCurve(curve, t) : 1, 0, 1);
}
/** The color at normalized life `t` (default white when no gradient is set). */
export function colorAt(gradient, t) {
    if (!gradient)
        return [1, 1, 1];
    return sampleGradient(gradient, t);
}
//# sourceMappingURL=curves.js.map