/**
 * File-path keys shared by the flows, the harness, the metrics and the
 * dashboard. Dependency-free on purpose: every layer needs the same
 * sanitizer, and a private copy in each (they existed) drifts.
 *
 * - AttributeMap instance keys, session fence labels and flow ids prohibit
 *   `/`, so a file path is sanitized with {@link sanitizeFileKey}.
 * - tsc and the prep source map name one file as `./src/a.ts` or `src/a.ts`;
 *   {@link stripDotSlash} makes those compare equal.
 */

/** Replaces `/` with `__` (the forward half of the identity key). */
export function sanitizeFileKey(file: string): string {
  return file.replace(/\//g, "__");
}

/**
 * The ONE inverse of {@link sanitizeFileKey} ("__" -> "/"). It is lossy for a
 * file whose own name contains "__" (`src/__tests__/Foo.php` inverts to
 * `src//tests//Foo.php`): prefer the authoritative `file` of a verdict record
 * and use this only when no record carries it (see renderReport).
 */
export function fileFromSanitizedKey(sanitized: string): string {
  return sanitized.replace(/__/g, "/");
}

/** Sanitized identity key for a file-round: `<sanitized file>#<round>`. */
export function identityKeyOf(file: string, round: number): string {
  return `${sanitizeFileKey(file)}#${round}`;
}

/**
 * Best-effort inverse of {@link identityKeyOf}: recover the file path and
 * round from a sanitized identity (see {@link fileFromSanitizedKey} for the
 * lossy "__" caveat). The round must be plain decimal digits: "1e2", "0x10"
 * and "-1" are rejected, not coerced by Number().
 */
export function fileFromIdentity(identity: string): { file: string; round: number } | null {
  const hash = identity.lastIndexOf("#");
  if (hash <= 0) return null;
  const roundPart = identity.slice(hash + 1);
  if (!/^\d+$/.test(roundPart)) return null;
  return { file: fileFromSanitizedKey(identity.slice(0, hash)), round: Number(roundPart) };
}

/** `./src/a.ts` -> `src/a.ts` (a path without the prefix is unchanged). */
export function stripDotSlash(path: string): string {
  return path.replace(/^\.\//, "");
}
