import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDataMigration } from './dataMigration.js';

const argumentsList = process.argv.slice(2);
const mode = argumentsList.includes('--apply') && !argumentsList.includes('--dry-run')
  ? 'apply'
  : argumentsList.includes('--dry-run') && !argumentsList.includes('--apply')
    ? 'dry-run'
    : null;

if (!mode) {
  console.error('Użycie: npm run data:migrate -- --dry-run | --apply');
  process.exitCode = 1;
} else {
  const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
  const result = await runDataMigration({
    dataDirectory: path.resolve(serverDirectory, '..', 'data'),
    mode,
  });
  console.log(JSON.stringify(result, null, 2));
}
