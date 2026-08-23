export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}

export function getArray(
  value: Record<string, unknown>,
  key: string,
): unknown[] | undefined {
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate : undefined;
}
