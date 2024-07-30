export async function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

export const gracefullyCloseSet = new Set<() => Promise<void>>();
const killSet = new Set<() => void>();

export async function gracefullyCloseAll() {
  await Promise.all(Array.from(gracefullyCloseSet).map(gracefullyClose => gracefullyClose().catch(e => {})));
}

export function gracefullyProcessExitDoNotHang(code: number) {
  // Force exit after 30 seconds.
  // eslint-disable-next-line no-restricted-properties
  setTimeout(() => process.exit(code), 30000);
  // Meanwhile, try to gracefully close all browsers.
  gracefullyCloseAll().then(() => {
    // eslint-disable-next-line no-restricted-properties
    process.exit(code);
  });
}

export type BrowsingClientParams = {
  wsEndpoint?: string;
  storage?: string;
  url?: string;
  recorderOutputPath?: string;
}