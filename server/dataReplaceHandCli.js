import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDataHandReplacement } from './dataHandReplacement.js';

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
const handId = valueAfter('--hand-id');
const filePath = valueAfter('--file');

if (!mode || !handId || !filePath) {
  console.error('Użycie: npm run data:replace-hand -- --hand-id <ID> --file <plik.txt> --dry-run | --apply');
  process.exitCode = 1;
} else {
  const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
  try {
    const result = await runDataHandReplacement({
      dataDirectory: path.resolve(serverDirectory, '..', 'data'),
      handId,
      filePath,
      mode,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`${error.code || 'REPLACEMENT_FAILED'}: ${error.message}`);
    process.exitCode = 1;
  }
}
