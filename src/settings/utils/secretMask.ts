/** 敏感信息掩码展示（不下发明文到 Webview 默认态） */
export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.length <= 4) {
    return '••••';
  }
  const prefix = trimmed.startsWith('sk-') ? 'sk-' : trimmed.slice(0, Math.min(3, trimmed.length));
  const suffix = trimmed.slice(-4);
  const middleLen = Math.max(8, Math.min(12, trimmed.length - prefix.length - suffix.length));
  return `${prefix}${'•'.repeat(middleLen)}${suffix}`;
}

export interface SecretDisplayInfo {
  configured: boolean;
  masked: string;
}

export function secretDisplayInfo(value: string | undefined): SecretDisplayInfo {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return { configured: false, masked: '' };
  }
  return { configured: true, masked: maskSecret(trimmed) };
}
