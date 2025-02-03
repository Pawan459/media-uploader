import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Map "@app" to the "src" folder (adjust as needed)
      '@app': resolve(__dirname, 'src'),
    },
  },
})