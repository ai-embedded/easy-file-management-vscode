# VSCode 调试配置说明

## Windows + SSH 远程开发调试指南

### 🚀 快速开始

1. **确保SSH连接正常**
   - 确认VSCode已通过SSH连接到Linux服务器
   - 安装推荐的扩展（会自动提示）

2. **启动调试**
   ```
   按 F5 或选择 "🚀 启动扩展 (开发模式)"
   ```

3. **实时修改代码**
   - 修改 `src/extension.ts` - 会自动重新编译
   - 修改 `src/webview/*` 文件 - 会自动热重载webview

### 📋 调试配置说明

#### 🚀 启动扩展 (开发模式)
- **用途**: 日常开发调试
- **特点**: 
  - 自动启动文件监听
  - 实时编译TypeScript
  - Webview热重载
  - 详细调试日志
  - 自动保存文件

#### 🔧 启动扩展 (生产模式)  
- **用途**: 测试生产版本
- **特点**:
  - 一次性编译
  - 不启用热重载
  - 模拟发布环境

### 🔄 热重载功能

#### TypeScript 热重载
- 保存 `.ts` 文件后自动重新编译
- 需要刷新扩展宿主窗口看到效果 (`Ctrl+R`)

#### Webview 热重载  
- 保存 `src/webview/` 下任何文件立即生效
- 无需手动刷新，自动更新UI

### ⚙️ 自定义配置

#### 修改自动保存延迟
```json
// .vscode/settings.json
"files.autoSaveDelay": 1000  // 毫秒
```

#### 禁用热重载通知
```typescript  
// src/extension.ts
if (process.env.NODE_ENV === 'development') {
    // 注释掉这行
    // vscode.window.showInformationMessage('🔄 Webview 已热重载');
}
```

### 🛠️ 开发工作流

1. **启动开发模式**
   ```
   F5 -> 选择 "🚀 启动扩展 (开发模式)"
   ```

2. **打开扩展测试窗口**
   - 新窗口会自动打开
   - 右键文件/文件夹 -> "Open Vue Element UI Panel"

3. **编辑代码**
   - TypeScript: 保存后 `Ctrl+R` 刷新
   - Webview: 保存后自动更新

4. **调试技巧**
   - 在代码中设置断点
   - 查看 "调试控制台" 输出
   - 使用 `console.log()` 输出调试信息

### 🐛 常见问题

#### 1. F5 启动失败
**解决方案**: 确保项目已编译
```bash
npm run compile
```

#### 2. 热重载不工作
**检查**: 
- SSH连接是否稳定
- 文件监听权限是否正常
- 查看调试控制台错误信息

#### 3. TypeScript 编译错误
**解决方案**:
```bash
# 清理并重新编译
rm -rf dist/
npm run compile
```

#### 4. SSH连接断开后重新连接
**步骤**:
1. 重新连接SSH
2. 重新打开项目文件夹
3. 按F5重新启动调试

### 💡 提示

- 使用 `Ctrl+Shift+D` 快速打开调试面板
- 在SSH连接不稳定时，建议禁用文件自动保存
- 大文件修改时可能有短暂延迟，属正常现象
- 建议在稳定网络环境下进行开发

### 🐚 Shell兼容性说明

**默认Shell**: 已配置为使用您的默认shell (zsh)
- VSCode终端将使用zsh
- 构建脚本 (`build.sh`, `debug.sh`) 使用bash运行，但不会改变您的默认shell
- npm任务和调试任务都兼容zsh环境

**手动运行脚本**:
```bash
# 在zsh中运行构建脚本（推荐）
./build.sh build

# 或者显式使用bash运行
bash build.sh build
```