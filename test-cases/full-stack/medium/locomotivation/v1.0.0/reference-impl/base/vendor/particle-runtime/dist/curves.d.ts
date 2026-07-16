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
import type { ColorStop, Curve, InterpSpec, Vec3 } from "./contract";
/**
 * The eased fraction `[0, 1]` an {@link InterpSpec} maps a normalized input `s` to.
 * `constant` steps at the end; `bezier` reads as a smoothstep; the `ease-*` presets are
 * the CSS `cubic-bezier` timing curves.
 */
export declare function easeFraction(interp: InterpSpec, s: number): number;
/** Sample a {@link Curve} at normalized life `t` (clamped to `[0, 1]`). */
export declare function sampleCurve(curve: Curve, t: number): number;
/** An opaque `#rrggbb` string as linear `0..1` RGB (the render convention). */
export declare function hexToLinear(hex: string): Vec3;
/**
 * Sample a keyed color gradient at normalized life `t`, lerping between the two
 * bracketing stops. An empty gradient is white; before the first / after the last stop
 * clamps. Stops are expected ordered by {@link ColorStop.at}.
 */
export declare function sampleGradient(stops: readonly ColorStop[], t: number): Vec3;
/** The size factor at normalized life `t` (default `1` when no curve is set). */
export declare function sizeAt(curve: Curve | undefined, t: number): number;
/** The opacity at normalized life `t` (default fully opaque), clamped to `[0, 1]`. */
export declare function opacityAt(curve: Curve | undefined, t: number): number;
/** The color at normalized life `t` (default white when no gradient is set). */
export declare function colorAt(gradient: readonly ColorStop[] | undefined, t: number): Vec3;
//# sourceMappingURL=curves.d.ts.map