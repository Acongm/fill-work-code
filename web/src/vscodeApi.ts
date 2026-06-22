declare function acquireVsCodeApi(): {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

const devFallback = {
  postMessage: (message: unknown) => console.log('[vscode]', message),
  getState: () => ({}),
  setState: () => {},
};

export const vscode =
  typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : devFallback;
