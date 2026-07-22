interface ExternalLinkIconProps {
  className?: string;
}

// A small line-art "open in new tab" arrow (box with an arrow leaving its
// top-right) for the run-detail control strip's Grafana traces link. Drawn in
// `currentColor` so the caller sets color and size from CSS, matching the
// download and delete marks beside it.
export function ExternalLinkIcon({ className }: ExternalLinkIconProps) {
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
      {/* Box, open at its top-right corner where the arrow leaves. */}
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}
