import { bootstrap } from './bootstrap.js';
import type { SourceKey } from './types/source.js';

function parseArgs(argv: string[]): { once: boolean; sourceKey?: SourceKey } {
  const once = argv.includes('--once');
  const sourceArg = argv.find((arg) => arg.startsWith('--source='));
  const sourceKey = sourceArg?.split('=')[1] as SourceKey | undefined;

  return {
    once,
    sourceKey
  };
}

const options = parseArgs(process.argv.slice(2));

bootstrap(options).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
