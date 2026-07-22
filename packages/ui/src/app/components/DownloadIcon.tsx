interface DownloadIconProps {
  className?: string;
}

// A small line-art download arrow (arrow into a tray) for the run-detail control
// strip's archive link. Drawn in `currentColor` so the caller sets color and size
// from CSS, matching the bell/cabinet marks and the traces icon beside it.
export function DownloadIcon({ className }: DownloadIconProps) {
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
      {/* Tray. */}
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      {/* Arrow shaft and head pointing down into the tray. */}
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}
