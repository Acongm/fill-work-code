/** 版本发布 / 合并类噪音，不进入 AILog 润色 */
const RELEASE_NOISE_PATTERNS = [
  /\bv\d+\.\d+(\.\d+)?(-[\w.]+)?\b/i,
  /\b\d+\.\d+\.\d+(-[\w.]+)?\b.*\b(release|version|tag|bump)\b/i,
  /\b(release|changelog|version bump|bump version)\b/i,
  /发布\s*v?\d/i,
  /^chore(\(|:|\s)/i,
  /^merge\s+(branch|pull request|remote)/i,
  /^revert\s/i,
];

export function isReleaseNoiseText(text: string): boolean {
  const t = text.trim();
  if (!t) {
    return true;
  }
  return RELEASE_NOISE_PATTERNS.some((re) => re.test(t));
}

export function filterNoiseLines(lines: string[]): { kept: string[]; dropped: number } {
  const kept: string[] = [];
  let dropped = 0;
  for (const line of lines) {
    if (isReleaseNoiseText(line)) {
      dropped += 1;
    } else {
      kept.push(line);
    }
  }
  return { kept, dropped };
}

export function truncateForLog(text: string, maxLen = 1200): string {
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen)}…(${text.length} 字符)`;
}
