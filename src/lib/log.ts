const START = Date.now();

function stamp(): string {
  const s = ((Date.now() - START) / 1000).toFixed(1).padStart(6, " ");
  return `[${s}s]`;
}

export const log = {
  step(msg: string): void {
    console.log(`\n\x1b[1m\x1b[36m${stamp()} ▶ ${msg}\x1b[0m`);
  },
  info(msg: string): void {
    console.log(`${stamp()}   ${msg}`);
  },
  ok(msg: string): void {
    console.log(`${stamp()}   \x1b[32m✓\x1b[0m ${msg}`);
  },
  warn(msg: string): void {
    console.log(`${stamp()}   \x1b[33m!\x1b[0m ${msg}`);
  },
  error(msg: string): void {
    console.error(`${stamp()}   \x1b[31m✗\x1b[0m ${msg}`);
  },
  human(msg: string): void {
    console.log(`${stamp()}   \x1b[35m人手が必要\x1b[0m ${msg}`);
  },
};
