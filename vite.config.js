import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    watch: {
      // Raport AI jest zapisywany przez backend po każdej zakończonej analizie.
      // Nie jest kodem źródłowym — obserwowanie go powodowało pełny reload Vite
      // i utratę bieżącego wyboru sesji w widoku analizy zbiorczej.
      ignored: [
        '**/data/.cache/**',
        '**/data/inbox/**/*.txt',
        '**/data/poker/**',
        '**/data/poker-ai-analyses-v1.json',
        '**/data/poker-ai-analyses-v1.json.*.tmp',
      ],
    },
  },
})
