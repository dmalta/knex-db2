module.exports = {
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'commonjs',
    globals: {
      // Node.js globals
      global: 'readonly',
      process: 'readonly',
      Buffer: 'readonly',
      __dirname: 'readonly',
      __filename: 'readonly',
      module: 'readonly',
      require: 'readonly',
      exports: 'readonly',
      console: 'readonly',
      // Jest globals
      describe: 'readonly',
      test: 'readonly',
      expect: 'readonly',
      beforeAll: 'readonly',
      afterAll: 'readonly',
      beforeEach: 'readonly',
      afterEach: 'readonly',
      jest: 'readonly'
    }
  },
  rules: {
    'no-unused-vars': 'error',
    'no-explicit-any': 'off',
    'no-undef': 'error',
    'semi': ['error', 'always'],
    'quotes': ['error', 'single'],
    'indent': ['error', 2],
    'no-trailing-spaces': 'error',
    'eol-last': 'error'
  }
};
