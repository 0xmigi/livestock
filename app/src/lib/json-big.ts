/**
 * JSON that carries bigints. Account data is full of them, and JSON has no
 * such thing, so they travel as `{ "$big": "123" }` and come back as bigint.
 */

export function stringifyBig(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? { $big: v.toString() } : v));
}

export function parseBig<T>(text: string): T {
  return JSON.parse(text, (_, v) =>
    v && typeof v === "object" && typeof v.$big === "string" ? BigInt(v.$big) : v,
  ) as T;
}
