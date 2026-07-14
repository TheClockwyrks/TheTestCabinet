import { useState } from "react";
import { useModelConfig } from "../data/useModelConfig";
import { ModelProviderMark } from "./ModelProviderMark";
import styles from "./ModelLogoPicker.module.scss";

interface ModelLogoPickerProps {
  /** The current logo SVG the form holds (fetched + sanitized), or null. */
  value: string | null;
  /** The current svgl.app URL text (owned by the parent form). */
  url: string;
  /** The provider name, so the preview can fall back to its bundled mark before a
   * logo is fetched. */
  provider?: string;
  /** Called as the URL input changes. */
  onUrlChange: (url: string) => void;
  /** Called with the fetched, sanitized SVG once a fetch succeeds. */
  onFetched: (svg: string) => void;
}

// Only svgl.app is a trusted source for a provider mark — the backend fetches and
// sanitizes the SVG from there, so the picker refuses to attempt a fetch against
// any other host.
function isSvglUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "svgl.app" || host === "www.svgl.app";
  } catch {
    return false;
  }
}

// A controlled field for a model's provider mark: an svgl.app URL input, a
// "Fetch logo" button that resolves the sanitized SVG through the backend, and a
// live mask preview of the result. The parent form owns both the URL text and the
// fetched SVG; this only surfaces them and reports a fetch. Fetch is enabled only
// for an svgl.app URL (the trusted source), and a fetch failure shows inline.
export function ModelLogoPicker({
  value,
  url,
  provider = "",
  onUrlChange,
  onFetched,
}: ModelLogoPickerProps) {
  const config = useModelConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch is possible only with a config-capable, signed-in session and a
  // well-formed svgl.app URL.
  const canFetch = Boolean(config) && isSvglUrl(url) && !busy;

  const onFetch = async () => {
    if (!config || !isSvglUrl(url)) return;
    setBusy(true);
    setError(null);
    try {
      onFetched(await config.fetchLogo(url));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.picker}>
      <div className={styles.row}>
        <input
          className={styles.input}
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://svgl.app/library/openai.svg"
          aria-label="Provider logo svgl.app URL"
        />
        <button
          type="button"
          className={styles.fetch}
          onClick={onFetch}
          disabled={!canFetch}
          title={
            isSvglUrl(url)
              ? "Fetch and sanitize the logo from svgl.app"
              : "Enter an svgl.app URL to fetch a logo"
          }
        >
          {busy ? "Fetching…" : "Fetch logo"}
        </button>
        {/* The live mask preview: the fetched SVG when present, else the
            provider's bundled mark, else nothing (the mark component renders
            null). It reads in the accent color like every other cabinet glyph. */}
        <ModelProviderMark
          logoSvg={value}
          provider={provider}
          className={styles.preview}
        />
      </div>
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
