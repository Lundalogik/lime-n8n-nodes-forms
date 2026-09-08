module.exports = {
	testEnvironment: 'node',
	transform: {
		'^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
	},
	testMatch: ['**/tests/**/*.spec.ts'],
	verbose: true,
	testTimeout: 20_000,
	testPathIgnorePatterns: ['<rootDir>/dist/'],
	modulePathIgnorePatterns: ['<rootDir>/dist/'],
};
