/** @type {import('ts-jest').JestConfigWithTsJest} **/

const jestConfig = {
    testTimeout: 60000,
    testEnvironment: "node",
    moduleNameMapper: {
        "^@app/(.*)$": "<rootDir>/src/$1",
    },
    transform: {
        "^.+.tsx?$": [
            "ts-jest",
            {
                useESM: false,
                tsconfig: "tsconfig.jest.json",
            },
        ],
    },
};

export default jestConfig;
