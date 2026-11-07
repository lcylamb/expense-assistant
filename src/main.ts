import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';
import { APP_OPTIONS, applyGlobalSetup } from './app-setup.js';

async function bootstrap() {
  // 要 <NestExpressApplication> 这个泛型才能拿到 useStaticAssets ——
  // 它是 express 平台特有的，不在通用的 INestApplication 上。
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    APP_OPTIONS,
  );

  // 开发时前端在 Vite 上（5173，热更新），3100 只是接口 —— 它顺手也会托管
  // 上一次 `npm run build` 留在 public/ 里的那份静态文件。打开 3100 看到的是旧页面，
  // 改代码当然不会变，「每次都要重新 build」的错觉有一半出在这儿。
  // dev 脚本会设 DEV_WEB_ORIGIN，这里把根路径直接转过去；生产不设这个变量，行为不变。
  //
  // 必须赶在 applyGlobalSetup 之前注册：useStaticAssets 会把 `/` 抢走。
  const devWeb = process.env.DEV_WEB_ORIGIN;
  if (devWeb) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'GET' && req.path === '/') {
        res.redirect(302, devWeb);
        return;
      }
      next();
    });
  }

  applyGlobalSetup(app);

  // 收到 SIGTERM / SIGINT 时走一遍生命周期钩子 —— PrismaService 的 $disconnect 在那里。
  //
  // 加它，是因为容器里这件事从「锦上添花」变成了必须：
  // `docker stop` 和滚动更新发的都是 SIGTERM，不接住的话进程直接被杀，
  // 连接池里的连接会悬着，直到数据库那边自己超时回收。
  // 单机跑看不出问题，连接数一多就是「明明没请求，连接数却下不去」。
  //
  // 光接住信号还不够：默认的 `server.close()` 会等活跃请求跑完，而 SSE 是长连接。
  // 那一步由 APP_OPTIONS 里的 `forceCloseConnections` 管着 —— 理由写在 app-setup.ts。
  //
  // 放在 main.ts 而不是 app-setup.ts：测试里不想要它 ——
  // 注册全局信号监听会影响 vitest 自己的退出流程。
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
