import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')).version

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) }, // 설정 > 정보에 보이는 앱 버전
})
