const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**"]
  },
  expoConfig,
  {
    rules: {
      "react-hooks/exhaustive-deps": "warn"
    }
  }
]);
