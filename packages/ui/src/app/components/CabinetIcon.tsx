interface CabinetIconProps {
  className?: string;
}

// Line-art arcade cabinet mark for The Test Cabinet. Drawn entirely in
// `currentColor` so callers set its color (and size) from CSS — the brand
// orange in the topbar, inherited tones elsewhere. The matching favicon lives
// at `public/cabinet.svg`; keep the two artworks in sync.
export function CabinetIcon({ className }: CabinetIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Arcade cabinet"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {/* Cabinet body: rounded marquee shoulders down to a flared base. */}
        <path d="M17 11 Q17 6 22 6 L42 6 Q47 6 47 11 L47 50 L50 58 L14 58 L17 50 Z" />
        {/* Marquee divider. */}
        <path d="M18 17 H46" />
        {/* Screen bezel. */}
        <rect x="20" y="21" width="24" height="15" rx="2" />
        {/* Control panel edge. */}
        <path d="M18 43 H46" />
      </g>
      <g fill="currentColor" stroke="none">
        {/* "Play" glyph on the screen. */}
        <path d="M29 25 L37 28.5 L29 32 Z" />
        {/* Joystick ball and two action buttons. */}
        <circle cx="24" cy="49" r="2.4" />
        <circle cx="34" cy="50" r="2" />
        <circle cx="40" cy="50" r="2" />
      </g>
      {/* Joystick shaft. */}
      <path
        d="M24 51.4 V49"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </svg>
  );
}
