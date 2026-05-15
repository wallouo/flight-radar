export function createStableId(prefix: string, ...parts: string[]): string {
  const normalizedParts = parts.map((part) => part.trim()).filter(Boolean);
  return [prefix, ...normalizedParts].join("_");
}
