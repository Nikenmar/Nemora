import path from 'path';
import { fileURLToPath } from 'url';

import eslint from '@eslint/js';
import { includeIgnoreFile } from '@eslint/compat';
import globals from 'globals';
import tsLint from 'typescript-eslint';

import reactRefresh from 'eslint-plugin-react-refresh';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import promiseConfigs from 'eslint-plugin-promise';

// mimic CommonJS variables -- not needed if using CommonJS
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const gitignorePath = path.resolve(__dirname, '.gitignore');
const data = includeIgnoreFile(gitignorePath);

export default tsLint.config(
  {
    ...data,
    ignores: [...data.ignores, 'prettier.config.cjs', 'postcss.config.cjs', 'eslint.config.mjs']
  },
  // `@electron-toolkit/eslint-config-ts` used to sit here. It went out of
  // package.json with the rest of the Electron toolchain while this file went
  // on importing it, so `npm run lint` died on the first clean install with
  // ERR_MODULE_NOT_FOUND - the same failure `@electron-toolkit/tsconfig` caused
  // for type-checking, and fixed the same way: stop depending on an Electron
  // package in a project that has no Electron. What it contributed here was the
  // TypeScript parser and recommended set, which `tsLint.configs.recommended`
  // below already supplies, plus two rules this config turns off anyway.
  eslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  reactHooks.configs['recommended-latest'],
  reactRefresh.configs.recommended,
  {
    // `.mjs` and `.cjs` belong here too: without them the build scripts under
    // scripts/ and the postcss/prettier configs are linted with no globals at
    // all, which reports every use of `process` as an undefined variable.
    files: ['**/**/*.{js,mjs,cjs,ts,jsx,tsx}'],
    plugins: {
      react: react
    },
    extends: [importPlugin.flatConfigs.recommended, importPlugin.flatConfigs.typescript],
    settings: {
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts', '.tsx']
      },
      react: {
        version: 'detect'
      }
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  tsLint.configs.recommended,
  {
    // TypeScript resolves identifiers itself and fails the build on a real
    // undefined one, while `no-undef` has no notion of type-space names or of
    // lib globals such as `MediaQueryList`. typescript-eslint's own guidance is
    // to switch it off for TypeScript files rather than chase it with globals.
    files: ['**/*.{ts,tsx}'],
    rules: { 'no-undef': 'off' }
  },
  promiseConfigs.configs['flat/recommended'],
  {
    rules: {
      'react-refresh/only-export-components': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'import/no-unresolved': 'off',
      'import/named': 'off',
      'promise/always-return': ['warn', { ignoreLastCallback: true }],
      'react/no-unescaped-entities': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-useless-escape': 'off'
    }
  }
);
