# Easy File Management VSCode

一个功能强大的多协议文件传输工具，提供现代化的 Vue3 + Element Plus UI 界面。

## 功能特性

- 🚀 **多协议支持** - HTTP、TCP、FTP、UART 等多种传输协议
- 🎨 **现代化界面** - 基于 Vue3 + Element Plus 的友好用户界面
- 🔒 **安全可靠** - 内置主机白名单、协议检查等安全机制
- ⚡ **高性能传输** - 支持断点续传、分片传输、并发控制
- 🌍 **国际化支持** - 中英文双语界面

## 快速开始

### 安装

在 VSCode 扩展市场搜索 "Easy File Management" 并安装。

### 使用方法

1. **打开文件管理面板**
   - 方式一：右键点击文件或文件夹 → 选择 "Open Easy File Management VSCode Panel"
   - 方式二：按 `Ctrl+Shift+P` (Mac: `Cmd+Shift+P`) → 输入 "Easy File Management"

2. **配置连接**
   - 在打开的面板中选择协议类型（HTTP/TCP/FTP/UART）
   - 输入服务器地址和端口
   - 点击连接

3. **文件操作**
   - 上传/下载文件
   - 浏览远程文件系统
   - 管理文件和目录

## 配置选项

在 VSCode 设置中搜索 `fileManager` 可配置：

- **安全设置** - 主机白名单、协议检查、敏感头过滤
- **HTTP 设置** - 数据格式、分片大小、并发数、断点续传
- **高级选项** - 压缩、HTTP/2、超时时间等

## 支持的协议

| 协议 | 描述 | 状态 |
|------|------|------|
| HTTP/HTTPS | 基于 HTTP 的文件传输 | ✅ 支持 |
| TCP | 自定义 TCP 协议传输 | ✅ 支持 |
| FTP | 标准 FTP 文件传输 | ✅ 支持 |
| UART | 串口通信传输 | ✅ 支持 |

## 系统要求

- VSCode >= 1.102.0

## 许可证

MIT

## 反馈与贡献

如有问题或建议，欢迎在 [GitHub](https://github.com/example/easy-file-management.git) 提交 Issue。
