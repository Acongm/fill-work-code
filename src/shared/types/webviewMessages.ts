export type RemovedWebviewCommand =
  | 'selectXlsxImport'
  | 'confirmImport'
  | 'listMonthFiles'
  | 'sendEmail';

const REMOVED_WEBVIEW_COMMANDS = new Set<string>([
  'selectXlsxImport',
  'confirmImport',
  'listMonthFiles',
  'sendEmail',
]);

export function isRemovedWebviewCommand(
  value: string,
): value is RemovedWebviewCommand {
  return REMOVED_WEBVIEW_COMMANDS.has(value);
}
