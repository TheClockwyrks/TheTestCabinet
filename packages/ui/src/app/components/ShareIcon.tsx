interface ShareIconProps {
  className?: string;
}

// The share mark for the run-detail control strip: three nodes joined by two
// links. Drawn in `currentColor` so the caller sets color and size from CSS,
// matching the traces and download marks beside it.
export function ShareIcon({ className }: ShareIconProps) {
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
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 10.6l6.8-4" />
      <path d="M8.6 13.4l6.8 4" />
    </svg>
  );
}
