//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');
const { VueLoaderPlugin } = require('vue-loader');

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
const extensionConfig = {
  target: 'node', // VS Code extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/
	mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')

  entry: './src/extension.ts', // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
  output: {
    // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode' // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
    // modules added here also need to be added in the .vscodeignore file
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: ['.ts', '.js', '.proto'],
    alias: {
      // 添加路径别名，方便导入
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@proto': path.resolve(__dirname, 'proto')
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: true
            }
          }
        ]
      },
      {
        // 🚀 Protobuf 文件支持
        test: /\.proto$/,
        type: 'asset/source'
      }
    ]
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log", // enables logging required for problem matchers
  },
};

/** @type WebpackConfig */
const webviewConfig = {
  target: ['web', 'es2020'], // webview target
  mode: 'production',
  
  entry: './src/webview/main.ts',
  output: {
    path: path.resolve(__dirname, 'dist', 'webview'),
    filename: 'main.js',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.js', '.vue', '.json', '.proto'],
    alias: {
      '@': path.resolve(__dirname, 'src/webview'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@proto': path.resolve(__dirname, 'proto')
    }
  },
  module: {
    rules: [
      {
        test: /\.vue$/,
        use: 'vue-loader'
      },
      {
        test: /\.ts$/,
        loader: 'ts-loader',
        options: {
          appendTsSuffixTo: [/\.vue$/],
          transpileOnly: true,
          configFile: path.resolve(__dirname, 'src/webview/tsconfig.json')
        },
        exclude: /node_modules/
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.(png|jpe?g|gif|svg|woff|woff2|eot|ttf|otf)$/,
        type: 'asset/resource'
      },
      {
        // 🚀 Webview 中的 Protobuf 文件支持
        test: /\.proto$/,
        type: 'asset/source'
      }
    ]
  },
  plugins: [
    new VueLoaderPlugin(),
    // 为webview环境定义process.env，避免运行时错误
    new webpack.DefinePlugin({
      'process.env': JSON.stringify({}),
      'process': JSON.stringify({ env: {} })
    })
  ],
  devtool: 'source-map',
  stats: {
    errorDetails: true
  },
  ignoreWarnings: [
    /Failed to parse source map/,
    // 忽略不影响功能的警告
    warning => false
  ],
  performance: {
    hints: false
  }
};

module.exports = [ extensionConfig, webviewConfig ];
