interface BellIconProps {
  className?: string;
}

// A small line-art bell for the notifications topbar control. Drawn in
// `currentColor` so the caller sets color and size from CSS, matching the gear
// and cabinet marks beside it.
export function BellIcon({ className }: BellIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Bell body. */}
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      {/* Clapper. */}
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}
