export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts', '.mts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.m?js$': '$1',
  },
  transform: {
    '^.+\\.m?[tj]s$': ['ts-jest', {
      useESM: true,
    }],
  },
}; 