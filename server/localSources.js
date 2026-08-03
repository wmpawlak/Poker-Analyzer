import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA_DIRECTORY = path.resolve(serverDirectory, '..', 'data');

export const resolveLocalSourcePath = (filename, dataDirectory = DEFAULT_DATA_DIRECTORY) => {
  if (
    typeof filename !== 'string'
    || filename.length === 0
    || path.basename(filename) !== filename
    || path.extname(filename).toLowerCase() !== '.txt'
  ) {
    throw new Error('Nieprawidłowa nazwa pliku lokalnego.');
  }

  const resolvedDirectory = path.resolve(dataDirectory);
  const resolvedFile = path.resolve(resolvedDirectory, filename);
  if (!resolvedFile.startsWith(`${resolvedDirectory}${path.sep}`)) {
    throw new Error('Plik znajduje się poza katalogiem danych.');
  }

  return resolvedFile;
};

export const listLocalSources = async (dataDirectory = DEFAULT_DATA_DIRECTORY) => {
  let entries;
  try {
    entries = await fs.readdir(dataDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const textFiles = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.txt')
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));

  return Promise.all(textFiles.map(async (entry) => {
    const filePath = resolveLocalSourcePath(entry.name, dataDirectory);
    const stats = await fs.stat(filePath);
    return {
      filename: entry.name,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    };
  }));
};

export const readLocalSource = async (filename, dataDirectory = DEFAULT_DATA_DIRECTORY) => {
  const filePath = resolveLocalSourcePath(filename, dataDirectory);
  return fs.readFile(filePath, 'utf8');
};
