# VSCode 文件管理扩展 - 开发指南

这是一个功能强大的VSCode扩展，提供多协议文件管理功能，支持HTTP、FTP、TCP和串口连接。

## 常用开发命令

### 构建和编译
```bash
# 安装依赖
npm install

# 编译项目（TypeScript -> JavaScript）
npm run compile

# 监听模式开发（自动重新编译）
npm run watch

# 生产环境打包
npm run package

# 打包扩展文件
npm run package-extension
```

### 代码质量检查
```bash
# 运行ESLint检查
npm run lint

# 自动修复ESLint问题
npm run lint:fix

# 快速检查（编译 + lint）
npm run check:quick

# 完整检查（编译 + lint + 测试）
npm run check
```

### 测试
```bash
# 运行所有测试
npm run test

# 运行单元测试
npm run test:unit

# 监听模式测试
npm run test:watch

# 编译测试文件
npm run compile-tests
```

### 开发和调试
```bash
# 开发模式（清理 + 编译 + 监听）
npm run dev

# 构建项目（清理 + 编译）
npm run build

# 生产构建
npm run build:prod

# 清理构建文件
npm run clean
```

### 发布
```bash
# 安装vsce工具
npm run install:vsce

# 发布扩展
npm run publish

# 版本发布（补丁版本）
npm run publish:patch
```

## 核心架构

### 整体架构模式
这是一个典型的VSCode扩展 + Webview架构，采用**前后端分离**设计：

- **Extension Host（后端）**: TypeScript，运行在Node.js环境，处理VSCode API调用和网络连接
- **Webview（前端）**: Vue3 + Element Plus，运行在浏览器环境，提供用户界面
- **消息通信**: 通过VSCode Webview消息API进行双向通信

### 关键组件

#### 1. MessageRouter（消息路由器）
- **位置**: `src/extension/MessageRouter.ts`
- **职责**: 处理来自Webview的backend.*命令，路由到对应的网络客户端
- **模式**: 注册表模式，支持命令处理器动态注册
- **监控**: 集成请求追踪和性能监控

#### 2. 网络客户端层
```
src/extension/
├── ftp/FtpClient.ts      # FTP协议客户端
├── tcp/TcpClient.ts      # TCP协议客户端  
├── http/HttpClient.ts    # HTTP协议客户端
└── uart/               # 串口协议客户端（创新功能）
```

#### 3. 安全模块
- **位置**: `src/extension/security/SecurityConfig.ts`
- **功能**: URL验证、请求头过滤、路径校验、审计日志
- **配置**: 通过VSCode设置进行安全策略配置

#### 4. Webview前端
```
src/webview/
├── App.vue              # 主应用组件
├── main.ts             # Vue应用入口
├── components/         # UI组件
├── services/          # 前端服务层
└── composables/       # Vue组合式API
```

### 构建系统
- **Webpack双配置**: 
  - Extension配置：Node.js目标，处理后端代码
  - Webview配置：Web目标，处理Vue前端代码
- **TypeScript**: 严格模式，支持最新ES特性
- **Vue生态**: Vue3 + Element Plus + TypeScript

### 协议架构
所有网络协议使用**统一的11字节帧格式**：
```
[魔数2字节][数据长度2字节][序列号2字节][命令1字节][格式1字节][保留1字节][数据N字节][校验1字节][帧尾1字节]
```

### 状态管理
- **连接状态**: 通过ConnectionStatus枚举管理
- **操作跟踪**: activeOperations Map跟踪正在进行的操作
- **状态持久化**: 使用VSCode globalState API

## 开发注意事项

### Copilot集成说明
根据`.github/copilot-instructions.md`：
- 这是一个使用TypeScript的VSCode扩展项目
- 前端使用Vue3和Element Plus构建
- 扩展提供webview面板和右键菜单集成
- 使用webpack进行构建打包

### 热重载开发
- 开发模式下支持webview文件热重载
- 监听`src/webview`目录文件变化
- 自动重新加载webview内容

### 安全考虑
- 所有HTTP请求都经过安全验证
- 支持主机白名单和协议限制
- 敏感请求头自动过滤
- 文件路径安全校验

### 串口功能特色
- 业界首个基于Web Serial API的VSCode文件管理方案
- 支持CH340、CP2102、FT232等USB转串口芯片
- 统一协议设计，与TCP协议完全兼容
- 适用于IoT设备、嵌入式开发场景

### 测试和调试
- 按F5启动扩展开发主机进行调试
- 项目提供完整的Python测试服务器
- 支持多种连接类型的端到端测试