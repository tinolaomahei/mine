import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // Speech runs in its own utility process so decoding never blocks the UI.
          speech: resolve('src/main/speech/worker.ts'),
          // Commands (runtime abilities) run apart too, so a broken one can't freeze the window.
          commands: resolve('src/main/commands/worker.ts'),
          // MCP server agents use to restyle the app live.
          'theme-mcp': resolve('src/main/mcp/theme-server.ts'),
        },
      },
    },
  },
  preload: {
    resolve: { alias: shared },
  },
  renderer: {
    resolve: { alias: { '@': resolve('src/renderer/src'), ...shared } },
    plugins: [react(), tailwindcss()],
  },
})
