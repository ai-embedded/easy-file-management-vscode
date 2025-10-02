import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
    {
        files: ["**/*.ts"],
        ignores: ["out/**/*", "dist/**/*", "node_modules/**/*", "**/*.d.ts"],
        plugins: {
            "@typescript-eslint": typescriptEslint,
        },
        languageOptions: {
            parser: tsParser,
            ecmaVersion: 2022,
            sourceType: "module",
            parserOptions: {
                project: "./tsconfig.json",
            },
        },
        rules: {
            // TypeScript特定规则
            "@typescript-eslint/naming-convention": [
                "warn",
                {
                    selector: "objectLiteralProperty",
                    modifiers: ["requiresQuotes"],
                    format: null,
                },
                {
                    selector: "property",
                    modifiers: ["static", "readonly"],
                    format: ["camelCase", "UPPER_CASE"],
                },
                {
                    selector: "property",
                    filter: {
                        regex: "^[A-Z0-9_]+$",
                        match: true,
                    },
                    format: ["UPPER_CASE"],
                },
                {
                    selector: "property",
                    filter: {
                        regex: "^__.*__$",
                        match: true,
                    },
                    format: null,
                },
                {
                    selector: "typeProperty",
                    filter: {
                        regex: "^__.*__$",
                        match: true,
                    },
                    format: null,
                },
                {
                    selector: "property",
                    filter: {
                        regex: "^[A-Z][A-Za-z0-9]*$",
                        match: true,
                    },
                    format: ["PascalCase"],
                },
                {
                    selector: "property",
                    filter: {
                        regex: "^[a-z0-9]+(?:_[a-z0-9]+)+$",
                        match: true,
                    },
                    format: ["snake_case"],
                },
                {
                    selector: "import",
                    format: ["camelCase", "PascalCase"],
                },
                {
                    selector: "variable",
                    modifiers: ["const"],
                    format: ["camelCase", "UPPER_CASE"],
                },
                {
                    selector: "variableLike",
                    format: ["camelCase"],
                },
                {
                    selector: "typeLike",
                    format: ["PascalCase"],
                },
                {
                    selector: "property",
                    format: ["camelCase"],
                    filter: {
                        regex: "^(_|\\$)",
                        match: false,
                    },
                },
            ],
            "@typescript-eslint/no-unused-vars": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-inferrable-types": "warn",

            // 代码质量规则
            "curly": "warn",
            "eqeqeq": "warn",
            "no-throw-literal": "warn",
            "semi": "warn",
            "no-var": "warn",
            "prefer-const": "warn",
            "no-console": "off", // VSCode扩展需要console
            "no-debugger": "warn",
            
            // 最佳实践
            "no-duplicate-imports": "warn",
            "no-unreachable": "warn",
            "no-unused-expressions": "warn",
            "prefer-template": "warn",
            "object-shorthand": "warn",
            
            // 代码风格
            "indent": ["warn", "tab", { "SwitchCase": 1 }],
            "quotes": ["warn", "single", { "avoidEscape": true }],
            "comma-dangle": ["warn", "never"],
            "max-len": "off",
        },
    },
    {
        files: ["src/webview/**/*.ts"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: "./src/webview/tsconfig.json",
            },
        },
    },
    // 测试文件特殊配置
    {
        files: ["src/test/**/*.ts"],
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
            "no-unused-expressions": "off",
        },
    },
];
