export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Returns `known` plus every field of `raw` that `known` doesn't define, so data written
 * by a newer (or older) version of Puphii survives being read and saved again.
 */
export function withUnknownFields<T extends object>(raw: unknown, known: T): T {
  if (!isRecord(raw)) return known;
  // A null-prototype object keeps a stored "__proto__" field as plain data.
  const unknown: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(raw)) if (!Object.prototype.hasOwnProperty.call(known, key)) unknown[key] = raw[key];
  return { ...unknown, ...known };
}

/** True when everything in `raw` is still present, unchanged, in `restored`. */
export function isPreserved(raw: unknown, restored: unknown): boolean {
  if (raw === null || typeof raw !== 'object') return Object.is(raw, restored);
  if (Array.isArray(raw)) {
    return Array.isArray(restored) && raw.length === restored.length && raw.every((item, index) => isPreserved(item, restored[index]));
  }
  if (!isRecord(restored)) return false;
  const record = raw as Record<string, unknown>;
  return Object.keys(record).every(
    (key) => Object.prototype.hasOwnProperty.call(restored, key) && isPreserved(record[key], restored[key]),
  );
}
