import { defineConfig } from "vitest/config";

/**
 * 单包测试配置。
 *
 * 分层即目录，按「断言对象是什么」切：
 *   - test/unit、test/integration、test/client-unit — 直连 src 源码，node 环境
 *   - test/client-dom — 直连 src/client/**，需要 DOM（happy-dom）
 *   - test/e2e — 真实端口、文件系统与子进程，超时放宽到 10 分钟
 *
 * 逐文件隔离显式钉住：多个测试文件在模块作用域设 `DSH_HOME`，被测单例在模块加载期就把落盘
 * 路径定死，共享 worker 会让单例沿用第一次求值时的 home。
 */
const LAYER_RUNTIME: Record<string, Record<string, unknown>> = {
  unit: { environment: "node", testTimeout: 60_000, hookTimeout: 60_000 },
  integration: { environment: "node", testTimeout: 60_000, hookTimeout: 60_000 },
  "client-unit": { environment: "node", testTimeout: 60_000, hookTimeout: 60_000 },
  "client-dom": { environment: "happy-dom", testTimeout: 30_000, hookTimeout: 30_000 },
  e2e: { environment: "node", testTimeout: 600_000, hookTimeout: 600_000 },
};

/** 层未登记即抛错（fail-closed）：静默退回默认 5s 会表现为无判据的随机 flake。 */
function runtimeFor(layer: string): Record<string, unknown> {
  const runtime = LAYER_RUNTIME[layer];
  if (runtime === undefined) throw new Error(`LAYER_RUNTIME 未登记层 "${layer}"`);
  return runtime;
}

const LAYERS = Object.keys(LAYER_RUNTIME);

export default defineConfig({
  test: {
    isolate: true,
    projects: LAYERS.map((layer) => ({
      test: {
        name: layer,
        include: [`test/${layer}/**/*.test.{ts,tsx}`],
        ...runtimeFor(layer),
      },
    })),
  },
});
