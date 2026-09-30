/** The primitive's own classes followed by the caller's, so a caller's layout
 * rule (a width, a flex basis) wins over nothing and adds to the treatment. */
export function controlClass(
  ...classes: (string | false | null | undefined)[]
): string {
  return classes.filter(Boolean).join(" ");
}
