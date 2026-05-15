import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
  resolve: {
    extensions: [".ts", ".js"],
    alias: [{ find: /^(\.\.\/src\/.*)\.js$/, replacement: "$1.ts" }],
  },
});
