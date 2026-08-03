import path from 'node:path';
import process from 'node:process';

export const loadLocalEnvironment = (projectDirectory) => {
  const environmentPath = path.join(projectDirectory, '.env.local');

  try {
    process.loadEnvFile(environmentPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};

