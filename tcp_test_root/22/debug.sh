#!/bin/bash

# Vue Element UI VSCode扩展 - 一键调试环境搭建脚本
# 运行此脚本后，直接按F5即可启动调试

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查命令是否存在
check_command() {
    if ! command -v $1 &> /dev/null; then
        log_error "$1 命令未找到，请先安装"
        exit 1
    fi
}

# 检查目录是否存在
check_directory() {
    if [ ! -d "$1" ]; then
        log_error "目录不存在: $1"
        exit 1
    fi
}

# 检查文件是否存在
check_file() {
    if [ ! -f "$1" ]; then
        log_error "文件不存在: $1"
        exit 1
    fi
}

# 主函数
main() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  Vue Element UI VSCode Extension Debug Setup${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo

    # 1. 环境检查
    log_info "检查开发环境..."
    check_command "node"
    check_command "npm"
    check_file "package.json"
    check_directory "src"
    
    NODE_VERSION=$(node --version)
    NPM_VERSION=$(npm --version)
    log_success "Node.js: $NODE_VERSION, npm: $NPM_VERSION"

    # 2. 检查并安装主项目依赖
    log_info "检查主项目依赖..."
    if [ ! -d "node_modules" ]; then
        log_warning "node_modules不存在，正在安装依赖..."
        npm install
    else
        log_success "主项目依赖已存在"
    fi

    # 3. 检查webview文件
    log_info "检查webview前端文件..."
    if [ -d "src/webview" ]; then
        WEBVIEW_FILES=$(find src/webview -name "*.html" -o -name "*.js" -o -name "*.css" | wc -l)
        log_success "webview文件已存在（${WEBVIEW_FILES}个文件）"
    else
        log_warning "webview目录不存在"
    fi

    # 4. 创建调试配置文件
    log_info "配置调试环境..."
    
    # 创建.vscode目录
    mkdir -p .vscode

    # 创建tasks.json
    cat > .vscode/tasks.json << 'EOF'
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "编译扩展",
            "type": "npm",
            "script": "compile",
            "group": {
                "kind": "build",
                "isDefault": true
            },
            "presentation": {
                "echo": true,
                "reveal": "silent",
                "focus": false,
                "panel": "shared",
                "showReuseMessage": true,
                "clear": false
            },
            "problemMatcher": "$tsc"
        },
        {
            "label": "监听编译",
            "type": "npm",
            "script": "watch",
            "group": "build",
            "presentation": {
                "echo": true,
                "reveal": "always",
                "focus": false,
                "panel": "new",
                "showReuseMessage": true,
                "clear": false
            },
            "problemMatcher": "$tsc-watch",
            "isBackground": true,
            "runOptions": {
                "runOn": "folderOpen"
            }
        },
        {
            "label": "启动Webview开发服务器",
            "type": "shell",
            "command": "npm run dev",
            "options": {
                "cwd": "${workspaceFolder}"
            },
            "group": "build",
            "presentation": {
                "echo": true,
                "reveal": "always",
                "focus": false,
                "panel": "new",
                "showReuseMessage": true,
                "clear": false
            },
            "isBackground": true,
            "problemMatcher": {
                "pattern": {
                    "regexp": "^.*$",
                    "file": 1,
                    "location": 2,
                    "message": 3
                },
                "background": {
                    "activeOnStart": true,
                    "beginsPattern": ".*Local:.*",
                    "endsPattern": ".*ready in.*"
                }
            }
        }
    ]
}
EOF

    # 创建launch.json
    cat > .vscode/launch.json << 'EOF'
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "🚀 运行扩展",
            "type": "extensionHost",
            "request": "launch",
            "args": [
                "--extensionDevelopmentPath=${workspaceFolder}",
                "--disable-extensions"
            ],
            "outFiles": [
                "${workspaceFolder}/out/**/*.js"
            ],
            "preLaunchTask": "编译扩展",
            "skipFiles": [
                "<node_internals>/**"
            ],
            "env": {
                "NODE_ENV": "development"
            },
            "console": "integratedTerminal",
            "internalConsoleOptions": "neverOpen"
        },
        {
            "name": "🔧 完整开发模式",
            "type": "extensionHost",
            "request": "launch",
            "args": [
                "--extensionDevelopmentPath=${workspaceFolder}"
            ],
            "outFiles": [
                "${workspaceFolder}/out/**/*.js"
            ],
            "preLaunchTask": "编译扩展",
            "skipFiles": [
                "<node_internals>/**"
            ],
            "env": {
                "NODE_ENV": "development",
                "VUE_ELEMENT_DEBUG": "true"
            },
            "console": "integratedTerminal",
            "internalConsoleOptions": "neverOpen"
        }
    ]
}
EOF

    # 创建settings.json（调试优化配置）
    cat > .vscode/settings.json << 'EOF'
{
    "typescript.preferences.includePackageJsonAutoImports": "on",
    "typescript.suggest.autoImports": true,
    "editor.codeActionsOnSave": {
        "source.fixAll.eslint": "explicit"
    },
    "files.exclude": {
        "out": false,
        "dist": true,
        "**/.git": true,
        "**/.svn": true,
        "**/.hg": true,
        "**/CVS": true,
        "**/.DS_Store": true,
        "**/Thumbs.db": true,
        "**/node_modules": false
    },
    "search.exclude": {
        "out": true,
        "dist": true,
        "**/node_modules": true
    },
    "debug.console.fontSize": 14,
    "debug.console.wordWrap": true
}
EOF

    log_success "调试配置文件已创建"

    # 5. 初始编译
    log_info "执行初始编译..."
    npm run compile
    log_success "初始编译完成"

    # 6. 启动后台监听编译
    log_info "启动TypeScript监听编译..."
    
    # 检查是否已经有watch进程在运行
    if pgrep -f "npm run watch" > /dev/null; then
        log_warning "检测到已有watch进程运行，跳过启动"
    else
        # 使用nohup在后台启动watch
        nohup npm run watch > watch.log 2>&1 &
        WATCH_PID=$!
        echo $WATCH_PID > .watch.pid
        sleep 2
        
        if ps -p $WATCH_PID > /dev/null; then
            log_success "TypeScript监听编译已启动 (PID: $WATCH_PID)"
        else
            log_error "TypeScript监听编译启动失败"
            exit 1
        fi
    fi

    # 7. 提示当前webview为内嵌式
    echo
    log_info "当前项目webview为内嵌式设计，无需独立开发服务器"
    log_info "webview内容将随扩展一同加载，可直接进行调试"

    # 8. 完成提示
    echo
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  🎉 调试环境搭建完成！${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo
    echo -e "${BLUE}📋 后续操作:${NC}"
    echo -e "  1. 现在您可以按 ${YELLOW}F5${NC} 启动调试"
    echo -e "  2. 或使用 ${YELLOW}Ctrl+Shift+D${NC} 打开调试面板"
    echo -e "  3. 选择 ${YELLOW}🚀 运行扩展${NC} 配置"
    echo
    echo -e "${BLUE}📊 监控信息:${NC}"
    if [ -f ".watch.pid" ]; then
        WATCH_PID=$(cat .watch.pid)
        echo -e "  📦 TypeScript监听编译: ${GREEN}运行中${NC} (PID: $WATCH_PID)"
    fi
    echo -e "  🌐 Webview: ${GREEN}内嵌式设计${NC} (无需独立服务器)"
    echo
    echo -e "${BLUE}🔧 常用命令:${NC}"
    echo -e "  停止后台服务: ${YELLOW}./debug.sh stop${NC}"
    echo -e "  查看编译日志: ${YELLOW}tail -f watch.log${NC}"
    echo -e "  查看webview文件: ${YELLOW}ls -la src/webview/${NC}"
    echo
    echo -e "${GREEN}🚀 准备就绪！按F5开始调试吧！${NC}"
}

# 停止所有后台服务
stop_services() {
    log_info "停止调试后台服务..."
    
    # 停止watch进程
    if [ -f ".watch.pid" ]; then
        WATCH_PID=$(cat .watch.pid)
        if ps -p $WATCH_PID > /dev/null; then
            kill $WATCH_PID
            log_success "已停止TypeScript监听编译 (PID: $WATCH_PID)"
        fi
        rm -f .watch.pid
    fi
    
    # 清理可能的进程
    pkill -f "npm run watch" 2>/dev/null || true
    
    log_success "所有后台服务已停止"
}

# 检查脚本参数
case "${1:-}" in
    "stop")
        stop_services
        exit 0
        ;;
    "help"|"-h"|"--help")
        echo "Vue Element UI VSCode扩展调试脚本"
        echo ""
        echo "用法:"
        echo "  $0          # 搭建调试环境"
        echo "  $0 stop     # 停止后台服务"
        echo "  $0 help     # 显示帮助"
        exit 0
        ;;
    "")
        main
        ;;
    *)
        log_error "未知参数: $1"
        echo "使用 '$0 help' 查看帮助"
        exit 1
        ;;
esac