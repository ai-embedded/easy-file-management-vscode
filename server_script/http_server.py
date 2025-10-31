#!/usr/bin/env python3
"""
HTTP 文件管理测试服务器
========================

该服务器用于 VS Code 扩展在 HTTP 模式下的端到端验证，目标是与 TCP 形态保持功能等价：
- 统一的文件枚举 / 元数据 / 删除 / 重命名 / 创建目录能力
- 支持流式下载、HTTP Range 分片下载与断点续传探测
- 支持 multipart/form-data 与 JSON(Base64) 双模式上传，并向后兼容旧客户端
- 暴露能力协商端点（/api/capabilities），宣告 Range / 上传特性

运行示例：
    python http_server.py --host 0.0.0.0 --port 8080 --path ./test_http_dir
"""

from __future__ import annotations

import argparse
import base64
import binascii
import cgi
import json
import logging
import mimetypes
import os
import shutil
import stat
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from typing import BinaryIO, Dict, Iterable, Optional, Tuple
from urllib.parse import parse_qs, quote, unquote, urlparse

CHUNK_SIZE = 64 * 1024
EXPOSE_HEADERS = (
    'Content-Length, Content-Disposition, Accept-Ranges, Content-Range, '
    'X-Server-Capabilities, X-Server-Info'
)
SERVER_INFO = {
    'name': 'VSCode HTTP Reference Server',
    'version': '2.0.0',
    'protocol': 'http/1.1'
}
SERVER_CAPABILITIES = {
    'formats': ['json'],
    'features': [
        'range-requests',
        'multipart-upload',
        'directory-operations',
        'delete',
        'rename'
    ]
}

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_FILE_PATH = PROJECT_ROOT / 'http_server.log'
LOG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE_PATH, mode='w', encoding='utf-8')
    ]
)

logger = logging.getLogger('HTTP_FILE_SERVER')
logger.info('📝 日志输出已启用: %s', LOG_FILE_PATH)


def _ensure_relative(path: Path, base_dir: Path) -> str:
    """将真实路径转换为以 / 开头的远程路径"""
    if path == base_dir:
        return '/'
    relative = path.relative_to(base_dir)
    return '/' + str(relative).replace(os.sep, '/')


def _parse_iso8601(value: str) -> Optional[datetime]:
    try:
        if value.endswith('Z'):
            value = value[:-1] + '+00:00'
        return datetime.fromisoformat(value)
    except ValueError:
        return None


class APIRequestHandler(SimpleHTTPRequestHandler):
    server_version = 'VSCodeHTTP/2.0'
    protocol_version = 'HTTP/1.1'

    def __init__(self, *args, directory: Optional[str] = None, base_dir: Optional[Path] = None, **kwargs):
        self.base_dir = Path(base_dir or directory or os.getcwd()).resolve()
        super().__init__(*args, directory=str(self.base_dir), **kwargs)

    # ------------------------------------------------------------------
    # Header helpers & utilities
    # ------------------------------------------------------------------

    def end_headers(self) -> None:  # noqa: D401 - HTTP header finalisation
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range, X-Requested-With, X-Client-Capabilities, X-Client-Version')
        self.send_header('Access-Control-Expose-Headers', EXPOSE_HEADERS)
        super().end_headers()

    def log_message(self, format: str, *args: object) -> None:  # noqa: D401 - customise logging
        thread_name = threading.current_thread().name
        logger.info('[%s] %s - %s', thread_name, self.address_string(), format % args)

    # ------------------------------------------------------------------
    # HTTP verbs
    # ------------------------------------------------------------------

    def do_OPTIONS(self) -> None:  # noqa: N802 - http verb
        parsed = urlparse(self.path)
        if parsed.path == '/api/capabilities':
            self._send_capabilities_response()
            return

        self.send_response(204)
        self.send_header('Allow', 'GET, POST, PUT, DELETE, OPTIONS, HEAD')
        self.end_headers()

    def do_HEAD(self) -> None:  # noqa: N802 - http verb
        parsed = urlparse(self.path)
        if parsed.path == '/api/files/download':
            self._handle_download(parsed, head_only=True)
            return
        if parsed.path.startswith('/api/'):
            self._send_json(200, {'status': 'ok'})
            return
        super().do_HEAD()

    def do_GET(self) -> None:  # noqa: N802 - http verb
        parsed = urlparse(self.path)
        if parsed.path == '/api/ping':
            self._send_json(200, {
                'status': 'ok',
                'message': 'pong',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })
            return
        if parsed.path == '/api/capabilities':
            self._send_capabilities_response()
            return
        if parsed.path == '/api/files':
            self._handle_list_files(parsed)
            return
        if parsed.path == '/api/files/info':
            self._handle_file_info(parsed)
            return
        if parsed.path == '/api/files/download':
            self._handle_download(parsed)
            return
        if parsed.path.startswith('/api/'):
            self._send_json_error(404, 'API端点未找到')
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802 - http verb
        parsed = urlparse(self.path)
        logger.debug('POST %s content-length=%s content-type=%s', self.path, self.headers.get('Content-Length'), self.headers.get('Content-Type'))
        if parsed.path == '/api/files/directory':
            self._handle_create_directory()
            return
        if parsed.path == '/api/files/upload':
            self._handle_upload()
            return
        if parsed.path == '/api/files/upload-base64':
            self._handle_upload_base64()
            return
        if parsed.path.startswith('/api/'):
            self._send_json_error(405, 'API端点未找到')
            return
        self.send_response(405)
        self.end_headers()

    def do_PUT(self) -> None:  # noqa: N802 - http verb
        parsed = urlparse(self.path)
        if parsed.path == '/api/files/rename':
            self._handle_rename()
            return
        self._send_json_error(405, 'API端点未找到')

    def do_DELETE(self) -> None:  # noqa: N802 - http verb
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api/files'):
            self._handle_delete(parsed)
            return
        self._send_json_error(405, 'API端点未找到')

    # ------------------------------------------------------------------
    # API handlers
    # ------------------------------------------------------------------

    def _handle_list_files(self, parsed) -> None:
        params = parse_qs(parsed.query)
        requested = params.get('path', ['/'])[0]
        safe_path = self._safe_path(requested)
        if safe_path is None:
            self._send_json_error(400, '无效的路径')
            return
        if not safe_path.exists():
            self._send_json_error(404, '路径不存在')
            return
        if not safe_path.is_dir():
            self._send_json_error(400, '路径不是目录')
            return

        files = [
            self._format_file_info(child)
            for child in sorted(safe_path.iterdir(), key=lambda p: p.name.lower())
            if not child.name.startswith('.')
        ]

        self._send_json(200, {
            'path': requested,
            'total': len(files),
            'files': files
        })

    def _handle_file_info(self, parsed) -> None:
        params = parse_qs(parsed.query)
        requested = params.get('path', [None])[0]
        if requested is None:
            self._send_json_error(400, '缺少路径参数')
            return
        safe_path = self._safe_path(requested)
        if safe_path is None or not safe_path.exists():
            self._send_json_error(404, '文件不存在')
            return

        self._send_json(200, self._format_file_info(safe_path))

    def _handle_download(self, parsed, head_only: bool = False) -> None:
        params = parse_qs(parsed.query)
        requested = params.get('path', [None])[0]
        if requested is None:
            self._send_json_error(400, '缺少文件路径')
            return

        safe_path = self._safe_path(requested)
        if safe_path is None or not safe_path.exists() or not safe_path.is_file():
            self._send_json_error(404, '文件不存在')
            return

        file_size = safe_path.stat().st_size
        range_header = self.headers.get('Range')
        start, end = 0, file_size - 1
        status = 200

        if range_header and range_header.startswith('bytes='):
            try:
                range_spec = range_header.split('=')[1].split(',')[0]
                start_str, end_str = range_spec.split('-')
                if start_str.strip():
                    start = int(start_str)
                if end_str.strip():
                    end = int(end_str)
            except (ValueError, IndexError):
                self._send_json_error(416, 'Range请求格式错误')
                return
            start = max(0, min(start, file_size - 1))
            end = max(start, min(end, file_size - 1))
            status = 206

        length = end - start + 1
        mime_type = mimetypes.guess_type(str(safe_path))[0] or 'application/octet-stream'

        self.send_response(status)
        self.send_header('Content-Type', mime_type)
        self.send_header('Content-Length', str(length))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Last-Modified', self._http_datetime(safe_path.stat().st_mtime))
        self.send_header('ETag', self._build_etag(safe_path))
        self.send_header('Content-Disposition', self._build_content_disposition(safe_path.name))
        if status == 206:
            self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
        self.end_headers()

        if head_only:
            return

        with safe_path.open('rb') as handle:
            handle.seek(start)
            remaining = length
            while remaining > 0:
                chunk = handle.read(min(CHUNK_SIZE, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)
        logger.info('文件下载: %s (%s bytes)', safe_path, length)

    def _log_upload_request_received(self, request_id: str, mode: str) -> datetime:
        client_host, client_port = self.client_address if self.client_address else ('unknown', None)
        received_at = datetime.now(timezone.utc)
        request_summary = {
            'mode': mode,
            'clientHost': client_host,
            'clientPort': client_port,
            'path': self.path,
            'contentLength': self.headers.get('Content-Length'),
            'contentType': self.headers.get('Content-Type'),
            'userAgent': self.headers.get('User-Agent'),
            'receivedAt': received_at.isoformat()
        }
        logger.info('[HTTP][upload][%s] 请求接入: %s', request_id, json.dumps(request_summary, ensure_ascii=False))
        return received_at

    def _handle_upload(self, request_id: Optional[str] = None) -> None:
        request_id = request_id or uuid.uuid4().hex[:12]
        request_start = time.perf_counter()
        request_received_at = self._log_upload_request_received(request_id, 'auto')
        content_type = self.headers.get('Content-Type', '')
        logger.debug('[HTTP][upload][%s] 处理上传请求: content-type=%s', request_id, content_type)
        if 'multipart/form-data' in content_type:
            self._handle_multipart_upload(request_id, request_start, request_received_at)
            return
        # 兼容旧版 JSON+Base64
        logger.info('[HTTP][upload][%s] 未检测到 multipart/form-data，执行 Base64 上传回退', request_id)
        self._handle_upload_base64(
            request_id=request_id,
            request_start=request_start,
            request_received_at=request_received_at,
            already_logged=True,
            fallback_from_multipart=True
        )

    def _handle_multipart_upload(self, request_id: str, request_start: float, request_received_at: datetime) -> None:
        raw_content_length = self.headers.get('Content-Length')
        transfer_encoding = (self.headers.get('Transfer-Encoding') or '').lower()
        content_length = int(raw_content_length) if raw_content_length and raw_content_length.isdigit() else None

        if (content_length is None or content_length <= 0) and transfer_encoding != 'chunked':
            self._send_json_error(400, '缺少请求数据')
            return

        upload_stream: BinaryIO
        chunked_temp: Optional[tempfile.SpooledTemporaryFile] = None

        if transfer_encoding == 'chunked' and (content_length is None or content_length <= 0):
            chunked_temp, content_length = self._decode_chunked_body()
            if chunked_temp is None or content_length is None:
                self._send_json_error(400, '无法解析chunked请求体')
                return
            upload_stream = chunked_temp
            raw_content_length = str(content_length)
            logger.debug('已将chunked请求体展开为临时文件 length=%s', content_length)
        else:
            upload_stream = self.rfile

        env = {
            'REQUEST_METHOD': 'POST',
            'CONTENT_TYPE': self.headers.get('Content-Type', ''),
            'CONTENT_LENGTH': raw_content_length or ''
        }
        parsing_started = time.perf_counter()
        form = cgi.FieldStorage(
            fp=upload_stream,
            headers=self.headers,
            environ=env,
            keep_blank_values=True,
            limit=None
        )
        parsing_finished = time.perf_counter()

        if chunked_temp is not None:
            chunked_temp.close()

        if 'file' not in form or not form['file'].file:
            self._send_json_error(400, '缺少文件数据')
            return

        file_field = form['file']
        if isinstance(file_field, list):
            file_field = file_field[0]
        filename = form.getvalue('filename') or file_field.filename or 'upload.bin'
        target_path = form.getvalue('path') or form.getvalue('targetPath') or '/'

        client_selected_at = form.getvalue('clientSelectedAt')
        selection_dt = _parse_iso8601(client_selected_at) if client_selected_at else None
        selection_lag_ms = None
        if selection_dt is not None:
            selection_lag_ms = int((request_received_at - selection_dt).total_seconds() * 1000)

        request_queue_delay_ms = int((parsing_started - request_start) * 1000)
        parse_duration_ms = int((parsing_finished - parsing_started) * 1000)

        parsed_context = {
            'filename': filename,
            'targetPath': target_path,
            'formKeys': list(form.keys()),
            'contentLength': raw_content_length,
            'transferEncoding': transfer_encoding or None,
            'queueDelayMs': request_queue_delay_ms,
            'parseDurationMs': parse_duration_ms,
            'clientSelectedAt': client_selected_at,
            'selectionLagMs': selection_lag_ms
        }
        logger.info('[HTTP][upload][%s] 表单解析完成: %s', request_id, json.dumps(parsed_context, ensure_ascii=False))

        safe_target = self._resolve_target_path(target_path, filename)
        if safe_target is None:
            self._send_json_error(400, '无效的目标路径')
            return
        safe_target.parent.mkdir(parents=True, exist_ok=True)

        write_started = time.perf_counter()
        written_bytes = 0
        with safe_target.open('wb') as dest:
            file_obj = file_field.file
            while True:
                chunk = file_obj.read(CHUNK_SIZE)
                if not chunk:
                    break
                dest.write(chunk)
                written_bytes += len(chunk)
        write_finished = time.perf_counter()

        remote_path = _ensure_relative(safe_target, self.base_dir)
        responded_at = datetime.now(timezone.utc)
        selection_to_finish_ms = None
        if selection_dt is not None:
            selection_to_finish_ms = int((responded_at - selection_dt).total_seconds() * 1000)

        completion_context = {
            'mode': 'multipart',
            'filename': filename,
            'targetPath': target_path,
            'remotePath': remote_path,
            'absolutePath': str(safe_target),
            'writtenBytes': written_bytes,
            'writeDurationMs': int((write_finished - write_started) * 1000),
            'totalDurationMs': int((write_finished - request_start) * 1000),
            'respondedAt': responded_at.isoformat(),
            'clientSelectedAt': client_selected_at,
            'selectionLagMs': selection_lag_ms,
            'selectionToFinishMs': selection_to_finish_ms,
            'queueDelayMs': request_queue_delay_ms
        }

        response = self._format_file_info(safe_target)
        response.update({'success': True, 'message': '文件上传成功'})
        self._send_json(200, response)
        logger.info('[HTTP][upload][%s] 上传完成: %s', request_id, json.dumps(completion_context, ensure_ascii=False))

    def _handle_upload_base64(
        self,
        request_id: Optional[str] = None,
        request_start: Optional[float] = None,
        request_received_at: Optional[datetime] = None,
        already_logged: bool = False,
        fallback_from_multipart: bool = False
    ) -> None:
        request_id = request_id or uuid.uuid4().hex[:12]
        request_start = request_start or time.perf_counter()
        if not already_logged:
            mode_label = 'base64-fallback' if fallback_from_multipart else 'base64'
            request_received_at = self._log_upload_request_received(request_id, mode_label)
        request_received_at = request_received_at or datetime.now(timezone.utc)
        body = self._read_json_body(require_content=True)
        if body is None:
            return

        filename = body.get('filename') or 'upload.bin'
        target_path = body.get('path') or body.get('targetPath') or '/'
        encoded = body.get('content')
        if not encoded:
            self._send_json_error(400, '缺少文件内容')
            return

        client_selected_at = body.get('clientSelectedAt') if isinstance(body, dict) else None
        selection_dt = _parse_iso8601(client_selected_at) if isinstance(client_selected_at, str) else None
        selection_lag_ms = None
        if selection_dt is not None:
            selection_lag_ms = int((request_received_at - selection_dt).total_seconds() * 1000)

        logger.info(
            '[HTTP][upload][%s] JSON请求解析完成: %s',
            request_id,
            json.dumps({
                'filename': filename,
                'targetPath': target_path,
                'bodyKeys': list(body.keys()),
                'fallbackFromMultipart': fallback_from_multipart,
                'clientSelectedAt': client_selected_at,
                'selectionLagMs': selection_lag_ms
            }, ensure_ascii=False)
        )

        decoded_started = time.perf_counter()

        safe_target = self._resolve_target_path(target_path, filename)
        if safe_target is None:
            self._send_json_error(400, '无效的目标路径')
            return
        safe_target.parent.mkdir(parents=True, exist_ok=True)

        try:
            file_data = base64.b64decode(encoded)
        except (binascii.Error, TypeError) as exc:
            logger.warning('Base64 解码失败: %s', exc)
            self._send_json_error(400, '文件内容格式错误（无效的base64编码）')
            return
        decoded_finished = time.perf_counter()

        file_size = len(file_data)
        with safe_target.open('wb') as handle:
            handle.write(file_data)
        write_finished = time.perf_counter()

        remote_path = _ensure_relative(safe_target, self.base_dir)
        responded_at = datetime.now(timezone.utc)
        selection_to_finish_ms = None
        if selection_dt is not None:
            selection_to_finish_ms = int((responded_at - selection_dt).total_seconds() * 1000)

        completion_context = {
            'mode': 'base64-fallback' if fallback_from_multipart else 'base64',
            'filename': filename,
            'targetPath': target_path,
            'remotePath': remote_path,
            'absolutePath': str(safe_target),
            'decodedBytes': file_size,
            'decodeDurationMs': int((decoded_finished - decoded_started) * 1000),
            'writeDurationMs': int((write_finished - decoded_finished) * 1000),
            'totalDurationMs': int((write_finished - request_start) * 1000),
            'respondedAt': responded_at.isoformat(),
            'clientSelectedAt': client_selected_at,
            'selectionLagMs': selection_lag_ms,
            'selectionToFinishMs': selection_to_finish_ms,
            'queueDelayMs': int((decoded_started - request_start) * 1000)
        }

        response = self._format_file_info(safe_target)
        response.update({'success': True, 'message': '文件上传成功'})
        self._send_json(200, response)
        logger.info('[HTTP][upload][%s] 上传完成: %s', request_id, json.dumps(completion_context, ensure_ascii=False))

    def _handle_create_directory(self) -> None:
        body = self._read_json_body(require_content=True)
        if body is None:
            return

        parent_path = body.get('path', '/')
        dir_name = body.get('name')
        if not dir_name:
            self._send_json_error(400, '缺少目录名称')
            return

        if parent_path.endswith('/'):
            remote_target = f"{parent_path.rstrip('/')}/{dir_name}" if parent_path not in ('/', '') else f"/{dir_name}"
        else:
            remote_target = f"{parent_path}/{dir_name}"

        safe_target = self._safe_path(remote_target)
        if safe_target is None:
            self._send_json_error(400, '无效的路径')
            return
        if safe_target.exists():
            self._send_json_error(409, '目录已存在')
            return

        safe_target.mkdir(parents=True, exist_ok=True)
        self._send_json(200, {
            'success': True,
            'message': '目录创建成功',
            'path': _ensure_relative(safe_target, self.base_dir)
        })
        logger.info('目录创建: %s', safe_target)

    def _handle_delete(self, parsed) -> None:
        params = parse_qs(parsed.query)
        requested = params.get('path', [None])[0]
        if not requested:
            self._send_json_error(400, '缺少文件路径参数')
            return

        safe_path = self._safe_path(requested)
        if safe_path is None or not safe_path.exists():
            self._send_json_error(404, '文件或目录不存在')
            return

        if safe_path.is_dir():
            shutil.rmtree(safe_path)
            deleted_type = '目录'
        else:
            safe_path.unlink()
            deleted_type = '文件'

        self._send_json(200, {
            'success': True,
            'message': f'{deleted_type}删除成功',
            'path': requested,
            'type': deleted_type
        })
        logger.info('%s删除: %s', deleted_type, safe_path)

    def _handle_rename(self) -> None:
        body = self._read_json_body(require_content=True)
        if body is None:
            return

        old_path = body.get('oldPath')
        new_path = body.get('newPath')
        if not old_path or not new_path:
            self._send_json_error(400, '缺少oldPath或newPath参数')
            return

        safe_old = self._safe_path(old_path)
        safe_new = self._safe_path(new_path)
        if safe_old is None or safe_new is None:
            self._send_json_error(400, '无效的文件路径')
            return
        if not safe_old.exists():
            self._send_json_error(404, '源文件不存在')
            return
        if safe_new.exists():
            self._send_json_error(409, '目标文件已存在')
            return

        safe_new.parent.mkdir(parents=True, exist_ok=True)
        safe_old.rename(safe_new)

        self._send_json(200, {
            'success': True,
            'message': '文件重命名成功',
            'oldPath': old_path,
            'newPath': new_path
        })
        logger.info('文件重命名: %s -> %s', safe_old, safe_new)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _send_capabilities_response(self) -> None:
        payload = {
            'server': SERVER_INFO,
            'capabilities': SERVER_CAPABILITIES,
            'protocols': ['http/1.1'],
            'accepts': ['application/json']
        }
        headers = {
            'Accept': 'application/json',
            'Accept-Ranges': 'bytes',
            'X-Server-Capabilities': json.dumps(SERVER_CAPABILITIES),
            'X-Server-Info': json.dumps(SERVER_INFO, ensure_ascii=False)
        }
        self._send_json(200, payload, headers)

    def _decode_chunked_body(self) -> Tuple[Optional[tempfile.SpooledTemporaryFile], Optional[int]]:
        temp_file: Optional[tempfile.SpooledTemporaryFile] = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024)
        total_written = 0

        try:
            while True:
                size_line = self.rfile.readline()
                if not size_line:
                    logger.warning('chunked请求体缺少大小说明行')
                    return None, None

                size_str = size_line.strip().split(b';', 1)[0]
                if not size_str:
                    # 允许空行（例如额外的\r\n），继续读取
                    continue

                try:
                    chunk_size = int(size_str, 16)
                except ValueError:
                    logger.warning('无法解析chunk大小: %s', size_str)
                    return None, None

                if chunk_size == 0:
                    break

                remaining = chunk_size
                while remaining > 0:
                    chunk = self.rfile.read(min(CHUNK_SIZE, remaining))
                    if not chunk:
                        logger.warning('chunked请求体提前结束，剩余未读字节=%s', remaining)
                        return None, None
                    temp_file.write(chunk)
                    total_written += len(chunk)
                    remaining -= len(chunk)

                # 读取chunk结尾的CRLF
                trailer = self.rfile.read(2)
                if trailer not in (b'\r\n', b'\n', b''):
                    logger.debug('chunk结尾存在额外数据: %s', trailer)

            # 读取可选的trailer headers直到空行
            while True:
                trailer_line = self.rfile.readline()
                if trailer_line in (b'', b'\r\n', b'\n'):
                    break

            temp_file.seek(0)
            return temp_file, total_written
        except Exception as exc:
            logger.exception('解析chunked请求体失败: %s', exc)
            if temp_file is not None:
                temp_file.close()
            return None, None

    def _send_json(self, status: int, payload: Dict, headers: Optional[Dict[str, str]] = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        if headers:
            for key, value in headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _send_json_error(self, status: int, message: str) -> None:
        log_func = logger.error if status >= 500 else logger.warning
        log_func('HTTP %s: %s', status, message)
        self._send_json(status, {'error': True, 'message': message})

    def _read_json_body(self, require_content: bool = False) -> Optional[Dict]:
        length = int(self.headers.get('Content-Length', '0'))
        if length <= 0:
            if require_content:
                self._send_json_error(400, '缺少请求数据')
                return None
            return {}
        raw = self.rfile.read(length)
        logger.debug('读取 JSON 请求: length=%s', length)
        if not raw:
            if require_content:
                self._send_json_error(400, '缺少请求数据')
            return None
        try:
            return json.loads(raw.decode('utf-8'))
        except json.JSONDecodeError:
            logger.exception('解析 JSON 失败，原始数据前 200 字节: %s', raw[:200])
            self._send_json_error(400, 'JSON格式错误')
            return None

    def _safe_path(self, requested_path: str) -> Optional[Path]:
        if not requested_path:
            requested_path = '/'
        requested_path = unquote(requested_path)
        normalized = requested_path.lstrip('/')
        target = (self.base_dir / normalized).resolve()
        if not str(target).startswith(str(self.base_dir)):
            return None
        return target

    def _resolve_target_path(self, target: str, filename: str) -> Optional[Path]:
        remote = target or '/'
        if remote.endswith('/'):
            remote = f"{remote}{filename}" if remote != '/' else f"/{filename}"
        else:
            remote = f"{remote}/{filename}"
        return self._safe_path(remote)

    def _format_file_info(self, path: Path) -> Dict:
        stats = path.stat()
        is_dir = path.is_dir()
        remote_path = _ensure_relative(path, self.base_dir)
        permissions = stat.filemode(stats.st_mode)
        return {
            'name': path.name or '/',
            'path': remote_path,
            'type': 'directory' if is_dir else 'file',
            'size': 0 if is_dir else stats.st_size,
            'lastModified': datetime.fromtimestamp(stats.st_mtime, tz=timezone.utc).isoformat(),
            'permissions': permissions,
            'isReadonly': not os.access(path, os.W_OK)
        }

    @staticmethod
    def _http_datetime(timestamp: float) -> str:
        return datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime('%a, %d %b %Y %H:%M:%S GMT')

    @staticmethod
    def _build_etag(path: Path) -> str:
        stats = path.stat()
        return f'W/"{stats.st_mtime_ns:x}-{stats.st_size:x}"'

    @staticmethod
    def _ascii_fallback(value: str) -> str:
        try:
            value.encode('ascii')
            return value
        except UnicodeEncodeError:
            fallback = value.encode('ascii', 'ignore').decode('ascii')
            fallback = ''.join(ch if ch.isprintable() and ch not in '"\\' else '_' for ch in fallback)
            return fallback or 'download'

    def _build_content_disposition(self, filename: str) -> str:
        ascii_name = self._ascii_fallback(filename)
        encoded_name = quote(filename)
        if ascii_name == filename:
            return f'attachment; filename="{ascii_name}"'
        return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded_name}"


def run_server(host: str, port: int, root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)

    class ThreadedServer(ThreadingHTTPServer):
        daemon_threads = True
        allow_reuse_address = True

    handler_factory = lambda *args, **kwargs: APIRequestHandler(*args, base_dir=root, **kwargs)  # noqa: E731
    server = ThreadedServer((host, port), handler_factory)  # type: ignore[arg-type]

    logger.info('HTTP 文件服务器已启动: http://%s:%s (threaded)', host, port)
    logger.info('服务根目录: %s', root)
    logger.info('能力列表: %s', ', '.join(SERVER_CAPABILITIES['features']))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info('接收到中断信号，准备关闭服务器...')
    finally:
        server.server_close()
        logger.info('服务器已关闭')


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='VSCode 扩展 HTTP 测试服务器')
    parser.add_argument('--host', default='0.0.0.0', help='监听地址 (默认: 0.0.0.0)')
    parser.add_argument('--port', type=int, default=8080, help='监听端口 (默认: 8080)')
    parser.add_argument('--path', default='.', help='文件根目录 (默认: 当前目录)')
    parser.add_argument('--log-level', default='INFO', help='日志等级 (默认: INFO)')
    parser.add_argument('--debug', action='store_true', help='启用调试日志，等价于 --log-level DEBUG')
    return parser.parse_args(list(argv))


def main(argv: Iterable[str]) -> int:
    args = parse_args(argv)
    level_name = 'DEBUG' if args.debug else args.log_level.upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(level=level, format='%(asctime)s - %(levelname)s - %(message)s')
    logger.setLevel(level)
    if args.debug:
        logger.debug('调试日志已启用')
    root = Path(args.path).resolve()
    logger.debug('使用参数: host=%s port=%s root=%s', args.host, args.port, root)
    run_server(args.host, args.port, root)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
