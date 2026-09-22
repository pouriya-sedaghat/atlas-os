/**
 * Derives the default logical name recorded for an operator-supplied input.
 *
 * The absolute path is needed to read the file during provisioning, but it must never reach the
 * snapshot manifest: provenance travels with the snapshot and must not disclose the layout of the
 * machine that built it. Only the final path component is recorded.
 *
 * Both separator styles are handled regardless of the host this runs on, because an operator may
 * pass a Windows path to a tool running under a POSIX shell, and because `node:path`'s platform
 * default would otherwise silently treat `C:\datasets\iran.osm.pbf` as one long file name.
 */
export function defaultInputName(path: string): string {
  const withoutTrailingSeparators = path.replace(/[/\\]+$/, '');
  const lastSeparator = Math.max(
    withoutTrailingSeparators.lastIndexOf('/'),
    withoutTrailingSeparators.lastIndexOf('\\'),
  );
  const basename = withoutTrailingSeparators.slice(lastSeparator + 1);
  // A bare drive designator such as `C:` leaves nothing meaningful behind.
  return /^[a-zA-Z]:$/.test(basename) ? '' : basename;
}
