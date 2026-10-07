import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 用相对 base ('./')，这样 dist/ 放在任何子路径下都能工作：
// GitHub Pages 的 /<repo>/ 、自定义域名根路径、本地 file:// 预览都无需改配置。
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
