module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": ["ts-jest", { tsconfig: "tsconfig.json" }]
  },
  moduleNameMapper: {
    "^@card-games/shared$": "<rootDir>/../../packages/shared/src/index.ts",
    "^@card-games/game-core$": "<rootDir>/../../packages/game-core/src/index.ts"
  },
  testEnvironment: "node"
};
