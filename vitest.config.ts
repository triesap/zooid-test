import {resolve} from "node:path"
import {defineConfig} from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@welshman/app": resolve(__dirname, "../welshman/packages/app/src"),
      "@welshman/content": resolve(__dirname, "../welshman/packages/content/src"),
      "@welshman/feeds": resolve(__dirname, "../welshman/packages/feeds/src"),
      "@welshman/lib": resolve(__dirname, "../welshman/packages/lib/src"),
      "@welshman/net": resolve(__dirname, "../welshman/packages/net/src"),
      "@welshman/router": resolve(__dirname, "../welshman/packages/router/src"),
      "@welshman/signer": resolve(__dirname, "../welshman/packages/signer/src"),
      "@welshman/store": resolve(__dirname, "../welshman/packages/store/src"),
      "@welshman/util": resolve(__dirname, "../welshman/packages/util/src"),
    },
  },
})
