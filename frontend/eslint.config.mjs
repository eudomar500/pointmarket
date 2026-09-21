import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Reported at untyped external boundaries (EIP-1193 provider objects,
      // GenLayerJS call arguments, caught errors). Kept visible as a warning
      // instead of retyping those boundaries, which would change behavior.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];

export default eslintConfig;
