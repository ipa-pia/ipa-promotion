// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
export default withNuxt({
  ignores: [".agents/**", ".claude/skills/**", "skills-lock.json"],
  // Your custom configs here
  rules: {
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/no-explicit-any": "warn",
  },
});
