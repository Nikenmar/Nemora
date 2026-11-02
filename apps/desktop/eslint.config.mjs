// PLAN/21 P21.1: the renderer's lint. The recommended sets of ESLint and typescript-eslint, the two
// hook rules, the accessibility and promise rules the code's own disable comments name; the type
// checker stays the judge of types (`npm run check-types`).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import promise from 'eslint-plugin-promise';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'src-tauri/**', 'node_modules/**', 'src/renderer/test/__snapshots__/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y, promise },
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'promise/catch-or-return': ['warn', { allowFinally: true }],
      // An underscore marks a name kept for its place (an IPC signature, an ignored argument).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Global types live in src/types/*.d.ts: the compiler, not the linter, knows them.
      'no-undef': 'off'
    }
  }
);
