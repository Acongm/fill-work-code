/** Git 远程地址过滤：兼容旧版 originHosts */

export function resolveOriginFilters(input: {
  originFilters?: string[];
  originHosts?: string[];
}): string[] {
  const fromFilters = (input.originFilters ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromFilters.length > 0) {
    return fromFilters;
  }
  return (input.originHosts ?? []).map((s) => s.trim()).filter(Boolean);
}
