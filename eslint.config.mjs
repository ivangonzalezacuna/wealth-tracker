import tseslint from 'typescript-eslint';

const unusedOptions = {
  args: 'all',
  argsIgnorePattern: '^_',
  caughtErrors: 'none',
  ignoreRestSiblings: true,
};

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '.yarn/**', 'test-results/**', 'playwright-report/**'],
  },
  {
    files: ['**/*.{js,mjs}'],
    rules: { 'no-unused-vars': ['error', unusedOptions] },
  },
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', unusedOptions],
    },
  },
];
