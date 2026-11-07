import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * 前端构建配置。
 *
 * 产物直接写进后端的 `public/`：Nest 用 `useStaticAssets` 托管这个目录，
 * 于是页面和 API 同源 —— 没有 CORS，也没有「cookie 到底算谁的域」这类问题。
 * 前端独立部署（Vercel 之类）当然也可以，但那就得为 cookie 配 SameSite=None + Secure
 * 和一份 CORS 白名单，这个项目不需要那层复杂度。
 */
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** 开发时后端在哪。默认 3100，和 `npm run start:dev` 一致。 */
const BACKEND = process.env.BACKEND_ORIGIN ?? 'http://127.0.0.1:3100';

export default defineConfig({
  // root 显式写成 web/：不带这个，配置从仓库根被加载时 Vite 会把根目录当 root，
  // 然后找不到 index.html。相对路径（outDir、public 资源）都按这个 root 解析。
  root: here('.'),
  plugins: [react()],
  build: {
    outDir: here('../public'),
    // public/ 是纯产物目录，每次构建都该从空的开始 —— 不然上一版的旧 chunk 会一直留着。
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // 开发服务器只做代理，业务代码里仍然写 `/assistant/...` 这种同源路径，
    // 生产环境不用改任何一行。
    proxy: {
      '/auth': BACKEND,
      '/assistant': BACKEND,
      '/health': BACKEND,
    },
  },
});
