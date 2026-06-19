// Helpers for resolving proof-of-implementation media.
//
// A run's proof media is served per file as `<proof-id>.<ext>`, where the
// extension comes from the proof's recorded `dest`. The gallery data provider
// builds each loadable URL from a host-supplied resolver; this derives the
// extension a file is served under from its dest path.

/** The lowercase file extension of a proof's `dest` path, defaulting to `png`. */
export function extensionFor(dest: string): string {
  const base = dest.split("/").pop() ?? dest;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return "png";
  }
  return base.slice(dot + 1).toLowerCase();
}
