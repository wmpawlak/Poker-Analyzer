import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTrainingMigration } from './trainingMigration.js';

const argumentsList = process.argv.slice(2);
const mode = argumentsList.includes('--apply') && !argumentsList.includes('--dry-run')
  ? 'apply'
  : argumentsList.includes('--dry-run') && !argumentsList.includes('--apply')
    ? 'dry-run'
    : null;
const valueAfter = (flag) => {
  const index = argumentsList.indexOf(flag);
  return index >= 0 ? argumentsList[index + 1] : '';
};

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(valueAfter('--data-dir') || path.join(serverDirectory, '..', 'data'));

if (!mode) {
  console.error('Użycie: npm run training:migrate -- --dry-run | --apply [--data-dir <katalog>]');
  process.exitCode = 1;
} else {
  try {
    const result = await runTrainingMigration({ dataDirectory, mode });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`${error.code || 'TRAINING_MIGRATION_FAILED'}: ${error.message}`);
    process.exitCode = 1;
  }
}
