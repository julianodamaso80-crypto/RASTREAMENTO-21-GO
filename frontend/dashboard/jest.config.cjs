/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // Equivale a '<rootDir>/src/**/*.test.ts'. Escrito assim porque no Windows o
  // jest mantém a barra de '\.claude' (worktree) como escape de glob e o
  // padrão com <rootDir> não casa com nada.
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // supercluster 8 só exporta ESM; o jest (CommonJS) carrega o bundle UMD.
    '^supercluster$': '<rootDir>/../../node_modules/supercluster/dist/supercluster.js',
  },
  transform: {
    // O tsconfig do Next usa module esnext + moduleResolution bundler, que o
    // jest (CommonJS) não carrega: só aqui troca para commonjs/node.
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
        },
      },
    ],
  },
};
