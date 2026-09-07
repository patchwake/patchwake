/** Small checks at JSON boundaries; TypeScript types alone do not validate remote data. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
export function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
export function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function hasCode(error: unknown, ...codes: string[]): boolean {
  return (
    isRecord(error) &&
    typeof error.code === "string" &&
    codes.includes(error.code)
  );
}
export function lookup<T>(
  value: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}
