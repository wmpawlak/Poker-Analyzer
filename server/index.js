import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApiApp } from './app.js';
import { loadLocalEnvironment } from './env.js';
import { configureSystemCertificates } from './systemCertificates.js';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(serverDirectory, '..');
loadLocalEnvironment(projectDirectory);
configureSystemCertificates();
const isProduction = process.argv.includes('--production');
const port = Number.parseInt(process.env.PORT || '5173', 10);

const app = express();
app.use(createApiApp());

if (isProduction) {
  const distDirectory = path.join(projectDirectory, 'dist');
  app.use(express.static(distDirectory));
  app.use((_request, response) => response.sendFile(path.join(distDirectory, 'index.html')));
} else {
  const vite = await createViteServer({
    root: projectDirectory,
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(port, () => {
  console.log(`Poker Analyzer: http://localhost:${port}`);
  console.log(`Tryb: ${isProduction ? 'production' : 'development'}, dane: ${path.join(projectDirectory, 'data')}`);
});
