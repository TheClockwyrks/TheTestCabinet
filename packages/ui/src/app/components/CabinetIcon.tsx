import { useId } from "react";

interface CabinetIconProps {
  className?: string;
  /** Fill with the brand's orange gradient rather than `currentColor`. */
  brand?: boolean;
}

// The Test Cabinet's mark: an arcade cabinet in profile, its joystick raised,
// with the horizon stripes of a synthwave sunset cut through its base. The
// stripes are a mask rather than shapes painted over it, so the mark sits on
// any background. Drawn in `currentColor` so callers set its color (and size)
// from CSS; `brand` swaps that for the brand gradient, as the topbar draws it.
// The favicon at `public/cabinet.svg` draws the same geometry on a dark rounded
// rect; keep the two artworks in sync.
export function CabinetIcon({ className, brand = false }: CabinetIconProps) {
  const id = useId();
  const maskId = `${id}-stripes`;
  const gradientId = `${id}-fill`;
  const body = brand ? `url(#${gradientId})` : "currentColor";
  const stick = brand ? "#ff9d2f" : "currentColor";
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Arcade cabinet"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {brand && (
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff9d2f" />
            <stop offset="1" stopColor="#ff5e3a" />
          </linearGradient>
        )}
        {/* The horizon stripes, thickening toward the base. */}
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="64"
          height="64"
        >
          <rect width="64" height="64" fill="#fff" />
          <g fill="#000">
            <rect x="12" y="40" width="44" height="1.1" />
            <rect x="12" y="44.2" width="44" height="1.7" />
            <rect x="12" y="48.8" width="44" height="2.3" />
            <rect x="12" y="54" width="44" height="2.9" />
          </g>
        </mask>
      </defs>
      {/* Cabinet body in profile: marquee, screen recess, control deck. */}
      <path
        d="M17 5 H43 L45.5 15 L37 17.5 L41 35 L52 37 V43 L43 46 V59 H17 Z"
        fill={body}
        stroke={body}
        strokeWidth={2}
        strokeLinejoin="round"
        mask={`url(#${maskId})`}
      />
      {/* Joystick shaft and ball on the control deck. */}
      <path
        d="M47 36 L48 30"
        fill="none"
        stroke={stick}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <circle cx="48.2" cy="28.6" r="2.8" fill={stick} />
    </svg>
  );
}
