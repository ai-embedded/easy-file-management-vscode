#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
增强版 FTP 测试服务器
----------------------

- 基于 pyftpdlib，提供与 TCP 测试服务端相近的演练能力：
  * 标准 FTP/FTPS 功能（LIST/MLSD/RETR/STOR/REST/MDTM/SIZE）
  * 被动模式端口可配置
  * 一次性故障注入（可模拟上传、下载、列目录失败）
  * 操作指标汇总，便于 VS Code 扩展对齐监控
- 可通过命令行参数调整监听地址、账号、根目录等。
- 默认会在工作目录下创建 `ftp_test_root/` 并生成测试文件/目录。
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict

from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import FTPHandler
from pyftpdlib.servers import FTPServer

# ---------------------------------------------------------------------------
# 日志配置
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_FILE_PATH = PROJECT_ROOT / 'ftp_server.log'
LOG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE_PATH, mode='w', encoding='utf-8')
    ]
)
logger = logging.getLogger('FTP_TEST_SERVER')
logger.info('📝 日志输出已启用: %s', LOG_FILE_PATH)


# ---------------------------------------------------------------------------
# 数据类定义
# ---------------------------------------------------------------------------
@dataclass
class FailureOptions:
    """一次性故障注入选项"""

    fail_upload_once: bool = False
    fail_download_once: bool = False
    fail_list_once: bool = False


@dataclass
class ServerOptions:
    """服务器运行时配置"""

    host: str
    port: int
    user: str
    password: str
    path: str
    passive_start: int
    passive_end: int
    allow_anonymous: bool
    debug: bool
    failure: FailureOptions


# ---------------------------------------------------------------------------
# FTP 处理器
# ---------------------------------------------------------------------------
class TestFTPHandler(FTPHandler):
    """自定义 FTP 处理器，增加指标、能力探测与故障注入"""

    encoding = 'utf-8'
    failure_options: FailureOptions = FailureOptions()
    metrics: Dict[str, int] = {
        'connections': 0,
        'logins': 0,
        'uploads': 0,
        'downloads': 0,
        'lists': 0,
        'failed_uploads': 0,
        'failed_downloads': 0,
        'failed_lists': 0
    }
    upload_failure_triggered: bool = False
    download_failure_triggered: bool = False
    list_failure_triggered: bool = False

    # 启用 MLSD 支持，便于能力检测
    use_mlsd = True

    @classmethod
    def reset_failure_flags(cls) -> None:
        cls.upload_failure_triggered = False
        cls.download_failure_triggered = False
        cls.list_failure_triggered = False

    @classmethod
    def dump_metrics(cls) -> None:
        logger.info('=== FTP 指标汇总 ===')
        for key, value in cls.metrics.items():
            logger.info('  %-18s : %s', key, value)

    # ------------------------------------------------------------------
    # 事件钩子
    # ------------------------------------------------------------------
    def on_connect(self) -> None:  # type: ignore[override]
        super().on_connect()
        TestFTPHandler.metrics['connections'] += 1
        logger.info('客户端连接: %s:%s', self.remote_ip, self.remote_port)

    def on_disconnect(self) -> None:  # type: ignore[override]
        super().on_disconnect()
        logger.info('客户端断开连接: %s:%s', self.remote_ip, self.remote_port)

    def on_login(self, username: str) -> None:  # type: ignore[override]
        super().on_login(username)
        TestFTPHandler.metrics['logins'] += 1
        logger.info('用户登录成功: %s (%s)', username, self.remote_ip)

    def on_logout(self, username: str) -> None:  # type: ignore[override]
        super().on_logout(username)
        logger.info('用户登出: %s', username)

    def on_file_sent(self, file: str) -> None:  # type: ignore[override]
        super().on_file_sent(file)
        logger.info('文件下载完成: %s', file)

    def on_file_received(self, file: str) -> None:  # type: ignore[override]
        super().on_file_received(file)
        logger.info('文件上传完成: %s', file)

    def ftp_OPTS(self, line: str):  # type: ignore[override]
        argument = (line or '').strip().upper()
        if argument == 'UTF8 ON':
            self.encoding = 'utf-8'
            self.respond('200 UTF8 encoding enabled.')
            return
        if argument == 'UTF8 OFF':
            self.encoding = 'latin-1'
            self.respond('200 UTF8 disabled.')
            return
        return super().ftp_OPTS(line)

    # ------------------------------------------------------------------
    # 命令覆盖：一次性故障注入 + 指标统计
    # ------------------------------------------------------------------
    def ftp_STOR(self, file: str, mode: str = 'w'):
        if (self.failure_options.fail_upload_once and
                not TestFTPHandler.upload_failure_triggered):
            TestFTPHandler.upload_failure_triggered = True
            TestFTPHandler.metrics['failed_uploads'] += 1
            logger.warning('[故障注入] 模拟上传失败: %s', file)
            self.respond('451 Requested action aborted: simulated upload failure.')
            return

        TestFTPHandler.metrics['uploads'] += 1
        return super().ftp_STOR(file, mode)

    def ftp_RETR(self, file: str):
        if (self.failure_options.fail_download_once and
                not TestFTPHandler.download_failure_triggered):
            TestFTPHandler.download_failure_triggered = True
            TestFTPHandler.metrics['failed_downloads'] += 1
            logger.warning('[故障注入] 模拟下载失败: %s', file)
            self.respond('451 Requested action aborted: simulated download failure.')
            return

        TestFTPHandler.metrics['downloads'] += 1
        return super().ftp_RETR(file)

    def ftp_LIST(self, path: str = ''):
        if (self.failure_options.fail_list_once and
                not TestFTPHandler.list_failure_triggered):
            TestFTPHandler.list_failure_triggered = True
            TestFTPHandler.metrics['failed_lists'] += 1
            logger.warning('[故障注入] 模拟 LIST 失败: %s', path or '.')
            self.respond('451 Requested action aborted: simulated list failure.')
            return

        TestFTPHandler.metrics['lists'] += 1
        return super().ftp_LIST(path)


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------
def create_test_directory_structure(base_path: str) -> None:
    """初始化测试目录结构和样例文件"""
    try:
        os.makedirs(base_path, exist_ok=True)

        # 样例目录
        directories = [
            'documents',
            'images',
            'videos',
            'empty_folder',
            'readonly'
        ]

        for folder in directories:
            os.makedirs(os.path.join(base_path, folder), exist_ok=True)

        # 设置只读目录，测试权限错误场景
        readonly_path = os.path.join(base_path, 'readonly')
        try:
            os.chmod(readonly_path, 0o555)
        except PermissionError:
            logger.warning('无法将 %s 设置为只读，继续执行', readonly_path)

        # 样例文件
        samples = {
            'readme.txt': '这是一个 FTP 测试文件\n包含中文内容测试\nFTP 服务器功能正常工作！',
            'test.json': '{\n  "name": "FTP测试",\n  "version": "1.0.0",\n  "description": "测试FTP服务器功能"\n}',
            'documents/sample.md': '# FTP测试文档\n\n- 文件上传\n- 文件下载\n- 目录创建\n- 文件删除',
            'images/info.txt': '图片文件夹说明',
        }

        for relative_path, content in samples.items():
            full_path = os.path.join(base_path, relative_path)
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, 'w', encoding='utf-8') as handle:
                handle.write(content)

        # 大文件（2MB）用于续传测试
        large_file_path = os.path.join(base_path, 'videos', 'big_file.bin')
        if not os.path.exists(large_file_path):
            with open(large_file_path, 'wb') as handle:
                handle.write(os.urandom(2 * 1024 * 1024))

        logger.info('测试目录结构已初始化: %s', base_path)
    except Exception as exc:  # pragma: no cover - 初始化失败时打印并继续
        logger.error('创建测试目录结构失败: %s', exc)


def parse_args() -> ServerOptions:
    parser = argparse.ArgumentParser(description='VSCode 扩展配套的 FTP 测试服务器')
    parser.add_argument('--host', default='0.0.0.0', help='监听地址（默认 0.0.0.0）')
    parser.add_argument('--port', type=int, default=2121, help='监听端口（默认 2121）')
    parser.add_argument('--path', '--root', dest='path', default=os.path.join(os.getcwd(), 'ftp_test_root'), help='根目录路径')
    parser.add_argument('--user', default='testuser', help='测试账号用户名')
    parser.add_argument('--password', default='testpass', help='测试账号密码')
    parser.add_argument('--passive-start', type=int, default=60000, help='被动模式起始端口')
    parser.add_argument('--passive-end', type=int, default=60100, help='被动模式结束端口')
    parser.add_argument('--allow-anonymous', action='store_true', help='启用匿名只读用户')
    parser.add_argument('--fail-upload-once', action='store_true', help='首次上传命令模拟失败')
    parser.add_argument('--fail-download-once', action='store_true', help='首次下载命令模拟失败')
    parser.add_argument('--fail-list-once', action='store_true', help='首次 LIST 命令模拟失败')
    parser.add_argument('--debug', action='store_true', help='启用调试日志（包括 pyftpdlib 调试信息）')

    args = parser.parse_args()

    failure = FailureOptions(
        fail_upload_once=args.fail_upload_once,
        fail_download_once=args.fail_download_once,
        fail_list_once=args.fail_list_once
    )

    return ServerOptions(
        host=args.host,
        port=args.port,
        user=args.user,
        password=args.password,
        path=os.path.abspath(args.path),
        passive_start=args.passive_start,
        passive_end=args.passive_end,
        allow_anonymous=args.allow_anonymous,
        failure=failure,
        debug=args.debug
    )


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------
def main() -> int:
    options = parse_args()

    if options.debug:
        logger.setLevel(logging.DEBUG)
        logging.getLogger('pyftpdlib').setLevel(logging.DEBUG)
        logger.debug('调试日志已启用')
    else:
        logging.getLogger('pyftpdlib').setLevel(logging.INFO)

    logger.info('=' * 72)
    logger.info('FTP 测试服务器启动准备...')
    logger.info('监听地址: %s:%s', options.host, options.port)
    logger.info('被动端口: %s-%s', options.passive_start, options.passive_end)
    logger.info('工作根目录: %s', options.path)
    logger.info('测试账户 : %s / %s', options.user, options.password)
    if options.allow_anonymous:
        logger.info('匿名访问 : 已启用 (只读)')
    logger.info('调试模式 : %s', '启用' if options.debug else '关闭')
    if any([options.failure.fail_upload_once, options.failure.fail_download_once, options.failure.fail_list_once]):
        logger.info('故障注入 : 上传=%s, 下载=%s, 列表=%s',
                    options.failure.fail_upload_once,
                    options.failure.fail_download_once,
                    options.failure.fail_list_once)
    logger.info('=' * 72)

    create_test_directory_structure(options.path)

    authorizer = DummyAuthorizer()
    authorizer.add_user(options.user, options.password, options.path, perm='elradfmwMT')
    if options.allow_anonymous:
        authorizer.add_anonymous(options.path, perm='elr')

    TestFTPHandler.authorizer = authorizer
    TestFTPHandler.failure_options = options.failure
    TestFTPHandler.reset_failure_flags()
    TestFTPHandler.passive_ports = range(options.passive_start, options.passive_end + 1)
    TestFTPHandler.banner = 'FTP测试服务器准备就绪. VSCode扩展测试专用.'
    TestFTPHandler.max_cons = 256
    TestFTPHandler.max_cons_per_ip = 10

    address = (options.host, options.port)
    server = FTPServer(address, TestFTPHandler)
    server.max_cons = 256
    server.max_cons_per_ip = 10

    logger.info('FTP 测试服务器启动成功，按 Ctrl+C 停止服务器。')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info('收到停止信号，正在关闭 FTP 服务器...')
    except Exception as exc:
        logger.error('FTP 服务器运行异常: %s', exc)
        return 1
    finally:
        try:
            server.close_all()
        except Exception:
            pass
        TestFTPHandler.dump_metrics()
        logger.info('FTP 测试服务器已停止')

    return 0


if __name__ == '__main__':
    sys.exit(main())
