import { providerLogo } from "../data/providerLogo";

interface ModelProviderMarkProps {
  /** The model's own curated, sanitized provider-logo SVG, preferred when set. */
  logoSvg: string | null;
  /** The provider name, used to fall back to a bundled brand mark. */
  provider: string;
  /** The styling class carrying the mark's size/color/glow (the host owns it). */
  className?: string;
}

/**
 * Resolve the CSS `mask-image` URL for a model's provider mark: the model's own
 * curated `logoSvg` (inlined as a `data:` URL) when it has one, else the bundled
 * brand mark for its provider, else `null` when neither exists. Exported so the
 * live logo preview in the config form can share the exact same resolution.
 */
export function providerMaskUrl(
  logoSvg: string | null,
  provider: string,
): string | null {
  if (logoSvg) {
    // Inline the SVG rather than reference a file; `encodeURIComponent` keeps the
    // markup a valid `data:` URL (svg often carries `#`, `<`, quotes).
    return `url("data:image/svg+xml,${encodeURIComponent(logoSvg)}")`;
  }
  const bundled = providerLogo(provider);
  return bundled ? `url(${bundled})` : null;
}

// A model's provider mark, rendered as a monochrome CSS mask span so it inherits
// the accent-and-glow treatment the rest of the cabinet's glyphs use (never an
// `<img>`, which would show the source's own colors). It prefers the model's own
// curated `logoSvg` over the provider's bundled brand mark, and renders nothing
// when neither is available so the surrounding layout simply omits the mark. The
// size/color/glow live in the caller's `className`; this only sets the mask image.
export function ModelProviderMark({
  logoSvg,
  provider,
  className,
}: ModelProviderMarkProps) {
  const mask = providerMaskUrl(logoSvg, provider);
  if (!mask) return null;
  return (
    <span
      className={className}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
      aria-hidden="true"
    />
  );
}
