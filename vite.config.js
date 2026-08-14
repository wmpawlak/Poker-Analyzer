import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  optimizeDeps: {
    holdUntilCrawlEnd: false,
    noDiscovery: true,
    include: [
      '@daypicker/react',
      '@daypicker/react/locale',
      '@reduxjs/toolkit',
      '@tanstack/react-virtual',
      'lucide-react',
      'react',
      'react-dom',
      'react-dom/client',
      'react-redux',
      'react/jsx-dev-runtime',
      'react/jsx-runtime',
      'recharts',
    ],
  },
  server: {
    watch: {
      // Raport AI jest zapisywany przez backend po każdej zakończonej analizie.
      // Nie jest kodem źródłowym — obserwowanie go powodowało pełny reload Vite
      // i utratę bieżącego wyboru sesji w widoku analizy zbiorczej.
      ignored: [
        '**/data/.cache/**',
        '**/data/.backups/**',
        '**/data/inbox/**/*.txt',
        '**/data/poker/**',
        '**/data/poker-ai-analyses-v1.json',
        '**/data/poker-ai-analyses-v1.json.*.tmp',
        '**/data/poker-training-v1.json',
        '**/data/.poker-training-v1.json.*.tmp',
        '**/data/poker-training-v1.json.migrated-*',
        '**/data/poker-training-v2.sqlite',
        '**/data/poker-training-v2.sqlite-wal',
        '**/data/poker-training-v2.sqlite-shm',
        '**/data/**/*.sqlite',
        '**/data/**/*.sqlite-wal',
        '**/data/**/*.sqlite-shm',
      ],
    },
  },
})
