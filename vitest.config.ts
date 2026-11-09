import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// 단위 테스트: 파서·인덱스 같은 순수 로직을 검증한다 (npm test)
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
  },
})
