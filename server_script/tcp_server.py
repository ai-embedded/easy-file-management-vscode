#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TCP文件管理测试服务器 - Protobuf专用版
用于测试VSCode扩展的TCP连接功能

协议格式：Protobuf over TCP
- 使用统一帧格式进行通信
- 消息体使用Protobuf二进制格式
- 支持基本文件操作：列表、下载、上传、删除、重命名、创建目录

运行方式:
python tcp_server.py --port 8765 --path tcp_test_root
"""

import os
import sys
import json
import base64
import socket
import threading
import time
import shutil
import logging
import struct
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime
import argparse
from typing import Iterable

# === 常量配置 ===
# 与 VS Code 扩展保持一致的分块上限 / 默认值
MAX_STREAM_CHUNK_BYTES = 4 * 1024 * 1024   # 4MB，对齐统一帧协议上限
DEFAULT_STREAM_CHUNK_BYTES = 2 * 1024 * 1024  # 2MB，与前端默认 chunkSize 一致
MIN_STREAM_CHUNK_BYTES = 64 * 1024         # 64KB，避免过小块导致性能退化

# 配置日志输出到文件/控制台，始终覆盖最新日志
PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_FILE_PATH = PROJECT_ROOT / 'tcp_server.log'
LOG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE_PATH, mode='w', encoding='utf-8')
    ]
)

logger = logging.getLogger('TCP_PROTOBUF_SERVER')
logger.info(f"📝 日志输出已启用: {LOG_FILE_PATH}")

# CRC8查表：使用与原协议一致的多项式 0x07
CRC8_POLY = 0x07


def _build_crc8_table(poly: int = CRC8_POLY) -> tuple[int, ...]:
    """生成CRC8查表，避免逐位运算带来的性能瓶颈"""
    table: list[int] = []
    for value in range(256):
        crc = value
        for _ in range(8):
            if crc & 0x80:
                crc = ((crc << 1) ^ poly) & 0xFF
            else:
                crc = (crc << 1) & 0xFF
        table.append(crc)
    return tuple(table)


CRC8_TABLE = _build_crc8_table()

# 强制要求真正的protobuf库
try:
    import google.protobuf.message
    from google.protobuf import message as protobuf_message
    logger.info("✅ Protobuf库已加载")
except ImportError as e:
    logger.error(f"❌ Protobuf库未安装: {e}")
    logger.error("请安装protobuf: pip install protobuf")
    sys.exit(1)


class ProtobufTcpServer:
    """TCP文件管理服务器 - 仅支持Protobuf协议"""

    # 命令定义（与统一协议Operation枚举保持一致）
    CMD_PING = 1          # Operation.PING = 1
    CMD_PONG = 2          # Operation.PONG = 2
    CMD_CONNECT = 3       # Operation.CONNECT = 3
    CMD_DISCONNECT = 4    # Operation.DISCONNECT = 4
    CMD_LIST_FILES = 16   # Operation.LIST_FILES = 16
    CMD_FILE_INFO = 17    # Operation.FILE_INFO = 17
    CMD_CREATE_DIR = 18   # Operation.CREATE_DIR = 18
    CMD_DELETE_FILE = 19  # Operation.DELETE_FILE = 19
    CMD_RENAME_FILE = 20  # Operation.RENAME_FILE = 20
    CMD_UPLOAD_FILE = 32  # Operation.UPLOAD_FILE = 32
    CMD_DOWNLOAD_FILE = 33 # Operation.DOWNLOAD_FILE = 33
    CMD_UPLOAD_REQ = 48   # Operation.UPLOAD_REQ = 48
    CMD_UPLOAD_DATA = 49  # Operation.UPLOAD_DATA = 49
    CMD_UPLOAD_END = 50   # Operation.UPLOAD_END = 50
    CMD_DOWNLOAD_REQ = 51 # Operation.DOWNLOAD_REQ = 51
    CMD_DOWNLOAD_DATA = 52 # Operation.DOWNLOAD_DATA = 52
    CMD_DOWNLOAD_END = 53 # Operation.DOWNLOAD_END = 53

    # 数据格式 - 仅支持Protobuf
    FORMAT_PROTOBUF = 0x02

    def __init__(self, host='0.0.0.0', port=8765, root_dir='tcp_test_root'):
        self.host = host
        self.port = port
        self.root_dir = Path(root_dir).resolve()
        self.socket = None
        self.clients = []
        self.running = False
        self.upload_sessions = {}
        self.download_sessions = {}

        # 确保根目录存在
        self.root_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"TCP服务器初始化: {host}:{port}")
        logger.info(f"服务根目录: {self.root_dir}")
        logger.info("🚀 协议: 仅支持Protobuf格式")

    def start(self):
        """启动TCP服务器"""
        try:
            self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.socket.bind((self.host, self.port))
            self.socket.listen(5)
            self.running = True

            logger.info("=" * 60)
            logger.info("🚀 TCP Protobuf文件管理服务器启动成功")
            logger.info(f"📍 监听地址: {self.host}:{self.port}")
            logger.info(f"📁 服务根目录: {self.root_dir}")
            logger.info("🔧 协议: 统一帧协议 (仅Protobuf格式)")
            logger.info("")
            logger.info("支持的操作:")
            logger.info("  - ping: 心跳测试")
            logger.info("  - list_files: 列出文件")
            logger.info("  - download_file: 下载文件")
            logger.info("  - upload_file: 上传文件")
            logger.info("  - delete_file: 删除文件")
            logger.info("  - rename_file: 重命名文件")
            logger.info("  - create_directory: 创建目录")
            logger.info("  - 分块传输支持")
            logger.info("")
            logger.info("按 Ctrl+C 停止服务器")
            logger.info("=" * 60)

            # 创建测试目录结构
            self.create_test_structure()

            while self.running:
                try:
                    client_socket, address = self.socket.accept()
                    logger.info(f"📥 客户端连接: {address}")

                    client_thread = threading.Thread(
                        target=self.handle_client,
                        args=(client_socket, address),
                        daemon=True
                    )
                    client_thread.start()
                    self.clients.append(client_socket)

                except socket.error:
                    if self.running:
                        logger.error("接受连接时出错")
                    break

        except Exception as e:
            logger.error(f"服务器启动失败: {e}")
            raise

    def stop(self):
        """停止服务器"""
        logger.info("正在关闭服务器...")
        self.running = False

        # 关闭所有客户端连接
        for client in self.clients:
            try:
                client.close()
            except:
                pass

        # 关闭服务器socket
        if self.socket:
            try:
                self.socket.close()
            except:
                pass

        # 清理未完成的上传/下载会话
        for session in list(self.download_sessions.values()):
            handle = session.get('file')
            if handle:
                try:
                    handle.close()
                except Exception:
                    pass
        self.download_sessions.clear()

        for session in list(self.upload_sessions.values()):
            handle = session.get('handle')
            if handle:
                try:
                    handle.close()
                except Exception:
                    pass
        self.upload_sessions.clear()

        logger.info("服务器已关闭")

    def create_test_structure(self):
        """创建测试目录结构和文件"""
        try:
            # 创建测试目录
            test_dirs = [
                'documents',
                'images',
                'projects/project1',
                'projects/project2',
                'temp'
            ]

            for dir_path in test_dirs:
                full_path = self.root_dir / dir_path
                full_path.mkdir(parents=True, exist_ok=True)

            # 创建测试文件
            test_files = {
                'readme.txt': 'TCP Protobuf测试服务器\\n仅支持Protobuf协议\\n高效二进制传输',
                'config.json': json.dumps({
                    'server': 'ProtobufTcpServer',
                    'version': '2.0.0',
                    'protocol': 'Protobuf over TCP',
                    'features': ['protobuf', 'frames', 'chunks', 'compression']
                }, indent=2, ensure_ascii=False),
                'documents/sample.md': '# TCP Protobuf测试\\n\\n这是使用Protobuf协议的测试文档。\\n\\n## 特性\\n\\n- 二进制高效传输\\n- 帧协议支持\\n- 分块传输',
                'documents/data.txt': '这是Protobuf测试数据文件\\n使用二进制协议传输',
                'projects/project1/main.py': '#!/usr/bin/env python3\\nprint("Hello, Protobuf TCP Server!")\\n',
                'projects/project2/readme.md': '# 项目2\\n\\n这是第二个Protobuf测试项目。'
            }

            for file_path, content in test_files.items():
                full_path = self.root_dir / file_path
                if not full_path.exists():
                    with open(full_path, 'w', encoding='utf-8') as f:
                        f.write(content)

            logger.info(f"✅ 测试目录结构创建完成: {len(test_files)} 个文件")

        except Exception as e:
            logger.error(f"创建测试目录结构失败: {e}")

    def handle_client(self, client_socket, address):
        """处理客户端连接 - 仅支持帧协议"""
        buffer = b""
        client_id = f"{address[0]}:{address[1]}"

        logger.info(f"[{client_id}] 开始处理客户端连接 (Protobuf-only)")

        try:
            while self.running:
                data = client_socket.recv(65536)  # 64KB缓冲区，减少系统调用开销
                if not data:
                    logger.info(f"[{client_id}] 客户端关闭连接")
                    break

                buffer += data
                if logger.level <= logging.DEBUG:
                    logger.debug(f"[{client_id}] 接收数据: {len(data)} 字节, 缓冲区总计: {len(buffer)} 字节")

                # 处理帧协议
                buffer = self.handle_frame_protocol(client_socket, address, buffer)

        except Exception as e:
            logger.error(f"客户端 {address} 处理错误: {e}")
        finally:
            logger.info(f"[{client_id}] 客户端断开连接")
            try:
                client_socket.close()
            except:
                pass
            if client_socket in self.clients:
                self.clients.remove(client_socket)

            # 检查是否存在仍未完成的下载会话（例如客户端异常断开）
            stale_sessions = [sid for sid, session in self.download_sessions.items() if session.get('clientId') == client_id]
            if stale_sessions:
                logger.warning(
                    f"[{client_id}] 连接结束仍存在 {len(stale_sessions)} 个未完成的下载会话，开始清理"
                )
                for sid in stale_sessions:
                    session = self.download_sessions.pop(sid, None)
                    if not session:
                        continue
                    try:
                        session['file'].close()
                    except Exception as close_error:
                        logger.warning(f"[DOWNLOAD_REQ] 清理会话 {sid} 时关闭句柄失败: {close_error}")
                    logger.warning(
                        f"[DOWNLOAD_REQ] 会话 {sid} 已清理 (bytesSent={session.get('bytesSent')}/{session.get('fileSize')}, path={session.get('path')})"
                    )

    def handle_frame_protocol(self, client_socket, address, buffer: bytes) -> bytes:
        """处理帧协议 - 仅Protobuf格式"""
        client_id = f"{address[0]}:{address[1]}"

        while True:
            # 尝试解析一个帧
            frame_result = self.parse_frame(buffer)
            if frame_result is None:
                break

            frame, consumed = frame_result
            buffer = buffer[consumed:]

            logger.info(f"[{client_id}][FRAME] 收到命令: {self.get_command_name(frame['command'])} (seq={frame['sequence']})")

            # 强制验证Protobuf格式
            if frame['format'] != self.FORMAT_PROTOBUF:
                logger.error(f"[{client_id}] 不支持的数据格式: 0x{frame['format']:02X}, 仅支持Protobuf(0x{self.FORMAT_PROTOBUF:02X})")
                # 发送错误响应
                error_response = {
                    'success': False,
                    'message': f'仅支持Protobuf格式 (0x{self.FORMAT_PROTOBUF:02X})',
                    'timestamp': int(time.time() * 1000)
                }
                error_frame = self.build_response_frame(
                    frame['command'],
                    self.FORMAT_PROTOBUF,
                    error_response,
                    frame['sequence']
                )
                client_socket.send(error_frame)
                continue

            # 解码Protobuf数据，并附带客户端标识便于会话跟踪
            request_data = self.decode_protobuf_data(frame['data'])
            if isinstance(request_data, dict):
                request_data['__client_id'] = client_id

            # 处理请求
            response = self.process_frame_request(frame['command'], request_data)

            # 构建Protobuf响应帧
            response_frame = self.build_response_frame(
                frame['command'],
                self.FORMAT_PROTOBUF,
                response,
                frame['sequence']
            )

            # 发送响应帧
            try:
                client_socket.send(response_frame)
                logger.info(f"[{client_id}][FRAME] 发送Protobuf响应: {self.get_command_name(frame['command'])}")
            except Exception as e:
                logger.error(f"[{client_id}][FRAME] 发送响应失败: {e}")
                raise

        return buffer

    def parse_frame(self, buffer: bytes) -> Optional[Tuple[Dict, int]]:
        """解析帧协议"""
        # 最小帧长度检查
        if len(buffer) < 13:
            return None

        # 查找魔数 0xAA55
        magic_index = -1
        for i in range(len(buffer) - 1):
            if buffer[i] == 0xAA and buffer[i + 1] == 0x55:
                magic_index = i
                break

        if magic_index == -1:
            return None

        # 如果魔数不在开头，丢弃之前的数据
        if magic_index > 0:
            buffer = buffer[magic_index:]

        # 读取数据长度
        if len(buffer) < 6:  # 2字节魔数 + 4字节长度
            return None
        data_length = struct.unpack('<I', buffer[2:6])[0]

        if data_length > 4 * 1024 * 1024:
            logger.error(f"[FRAME] 数据长度异常: {data_length} > 4194304")
            return None

        # 检查完整帧
        total_length = 13 + data_length
        if len(buffer) < total_length:
            return None

        # 解析帧头
        sequence = struct.unpack('<H', buffer[6:8])[0]
        command = buffer[8]
        format_type = buffer[9]

        # 提取数据
        data_start = 10
        data_end = data_start + data_length
        data = buffer[data_start:data_end]

        # CRC8校验
        crc8 = buffer[data_end]
        crc_data_view = memoryview(buffer)[2:data_end]
        calculated_crc8 = self.calculate_crc8(crc_data_view)

        if crc8 != calculated_crc8:
            logger.warning(f"[FRAME] CRC8校验失败: 期望 0x{calculated_crc8:02X}, 实际 0x{crc8:02X}")

        # 检查帧尾
        trailer_pos = data_end + 1
        if trailer_pos + 1 >= len(buffer):
            return None

        trailer = (buffer[trailer_pos] << 8) | buffer[trailer_pos + 1]
        if trailer != 0x55AA:
            logger.error(f"[FRAME] 帧尾错误: 期望 0x55AA, 实际 0x{trailer:04X}")
            return None

        frame = {
            'command': command,
            'format': format_type,
            'sequence': sequence,
            'data': data,
            'data_length': data_length,
            'crc': crc8
        }

        return frame, total_length

    def _decode_varint(self, data: bytes, offset: int) -> tuple:
        """解码varint，返回(值, 新offset)"""
        result = 0
        shift = 0
        while offset < len(data):
            byte = data[offset]
            offset += 1
            result |= (byte & 0x7F) << shift
            if not (byte & 0x80):
                return result, offset
            shift += 7
        raise ValueError("Invalid varint")

    def _decode_field(self, data: bytes, offset: int) -> tuple:
        """解码字段标签，返回(field_number, wire_type, 新offset)"""
        tag, offset = self._decode_varint(data, offset)
        field_number = tag >> 3
        wire_type = tag & 0x07
        return field_number, wire_type, offset

    def _decode_string(self, data: bytes, offset: int) -> tuple:
        """解码字符串，返回(字符串, 新offset)"""
        length, offset = self._decode_varint(data, offset)
        end = offset + length
        if end > len(data):
            raise ValueError("String length exceeds data size")
        value = data[offset:end].decode('utf-8')
        return value, end

    def _decode_bytes(self, data: bytes, offset: int) -> tuple:
        """解码字节数组，返回(字节数组, 新offset)"""
        length, offset = self._decode_varint(data, offset)
        end = offset + length
        if end > len(data):
            raise ValueError("Bytes length exceeds data size")
        return data[offset:end], end

    def _decode_bool(self, data: bytes, offset: int) -> tuple:
        """解码布尔值，返回(布尔值, 新offset)"""
        value, offset = self._decode_varint(data, offset)
        return value != 0, offset

    def _decode_int(self, data: bytes, offset: int) -> tuple:
        """解码整数，返回(整数, 新offset)"""
        return self._decode_varint(data, offset)

    def decode_unified_request(self, data: bytes) -> Dict[str, Any]:
        """解码UnifiedRequest protobuf消息"""
        request = {}
        offset = 0
        
        while offset < len(data):
            try:
                field_number, wire_type, offset = self._decode_field(data, offset)
                
                if field_number == 1:  # operation
                    operation_value, offset = self._decode_varint(data, offset)
                    # 映射枚举值到字符串
                    operation_map = {
                        1: 'PING',
                        2: 'PONG', 
                        3: 'CONNECT',
                        4: 'DISCONNECT',
                        16: 'LIST_FILES',
                        17: 'FILE_INFO',
                        18: 'CREATE_DIR',
                        19: 'DELETE_FILE',
                        20: 'RENAME_FILE',
                        32: 'UPLOAD_FILE',
                        33: 'DOWNLOAD_FILE',
                        48: 'UPLOAD_REQ',
                        49: 'UPLOAD_DATA',
                        50: 'UPLOAD_END',
                        51: 'DOWNLOAD_REQ',
                        52: 'DOWNLOAD_DATA',
                        53: 'DOWNLOAD_END'
                    }
                    request['operation'] = operation_map.get(operation_value, 'UNKNOWN')
                    
                elif field_number == 2:  # path
                    request['path'], offset = self._decode_string(data, offset)
                    
                elif field_number == 3:  # name
                    request['name'], offset = self._decode_string(data, offset)
                    
                elif field_number == 4:  # data
                    request['data'], offset = self._decode_bytes(data, offset)
                    
                elif field_number == 5:  # newName
                    request['newName'], offset = self._decode_string(data, offset)
                    
                elif field_number == 6:  # options (map<string, string>)
                    if wire_type != 2:
                        raise ValueError('options 字段必须是 length-delimited 类型')

                    entry_bytes, offset = self._decode_bytes(data, offset)

                    entry_offset = 0
                    key = None
                    value = None

                    while entry_offset < len(entry_bytes):
                        entry_field, entry_wire, entry_offset = self._decode_field(entry_bytes, entry_offset)

                        if entry_field == 1:  # key
                            key, entry_offset = self._decode_string(entry_bytes, entry_offset)
                        elif entry_field == 2:  # value
                            value, entry_offset = self._decode_string(entry_bytes, entry_offset)
                        else:
                            # 跳过未知字段
                            if entry_wire == 0:
                                _, entry_offset = self._decode_varint(entry_bytes, entry_offset)
                            elif entry_wire == 1:
                                entry_offset += 8
                            elif entry_wire == 2:
                                _, entry_offset = self._decode_bytes(entry_bytes, entry_offset)
                            elif entry_wire == 5:
                                entry_offset += 4
                            else:
                                break

                    if key is not None and value is not None:
                        options = request.setdefault('options', {})
                        options[key] = value

                        if key == 'newPath':
                            request.setdefault('newPath', value)
                        elif key in ('targetPath', 'destinationPath') and 'newPath' not in request:
                            request['newPath'] = value
                        
                elif field_number == 7:  # isChunk
                    request['isChunk'], offset = self._decode_bool(data, offset)
                    
                elif field_number == 8:  # chunkIndex
                    request['chunkIndex'], offset = self._decode_int(data, offset)
                    
                elif field_number == 9:  # totalChunks
                    request['totalChunks'], offset = self._decode_int(data, offset)
                    
                elif field_number == 10:  # chunkHash
                    request['chunkHash'], offset = self._decode_string(data, offset)
                    
                elif field_number == 11:  # clientId
                    request['clientId'], offset = self._decode_string(data, offset)
                    
                elif field_number == 12:  # version
                    request['version'], offset = self._decode_string(data, offset)
                    
                elif field_number == 13:  # supportedFormats (repeated)
                    format_str, offset = self._decode_string(data, offset)
                    if 'supportedFormats' not in request:
                        request['supportedFormats'] = []
                    request['supportedFormats'].append(format_str)
                    
                elif field_number == 14:  # filename
                    request['filename'], offset = self._decode_string(data, offset)
                    
                elif field_number == 15:  # fileSize
                    request['fileSize'], offset = self._decode_int(data, offset)
                    
                elif field_number == 16:  # checksum
                    request['checksum'], offset = self._decode_string(data, offset)
                    
                elif field_number == 17:  # chunkSize
                    request['chunkSize'], offset = self._decode_int(data, offset)
                    
                elif field_number == 18:  # preferredFormat
                    request['preferredFormat'], offset = self._decode_string(data, offset)
                    
                else:
                    # 跳过未知字段
                    if wire_type == 0:  # varint
                        _, offset = self._decode_varint(data, offset)
                    elif wire_type == 1:  # 64-bit
                        offset += 8
                    elif wire_type == 2:  # length-delimited
                        _, offset = self._decode_bytes(data, offset)
                    elif wire_type == 5:  # 32-bit
                        offset += 4
                    else:
                        logger.warning(f"未知wire_type: {wire_type} for field {field_number}")
                        break
                        
            except Exception as e:
                logger.warning(f"解码字段 {field_number if 'field_number' in locals() else '?'} 失败: {e}")
                break
                
        return request

    def decode_protobuf_data(self, data: bytes) -> Dict[str, Any]:
        """解码Protobuf数据 - 仅支持Protobuf二进制格式"""
        try:
            # 仅支持protobuf二进制数据解码
            request = self.decode_unified_request(data)
            
            # 记录解码结果
            if request:
                operation = request.get('operation', 'UNKNOWN')
                logger.info(f"✅ Protobuf解码成功: 操作={operation}, 字段数={len(request)}")
                # 只在debug模式下输出详细内容
                if logger.level <= logging.DEBUG:
                    # 对于包含大量二进制数据的操作，只输出摘要
                    if operation in ['UPLOAD_DATA', 'DOWNLOAD_DATA']:
                        summary = {k: (f"<binary {len(v)} bytes>" if isinstance(v, bytes) else v) 
                                  for k, v in request.items()}
                        logger.debug(f"解码内容摘要: {summary}")
                    else:
                        logger.debug(f"解码内容: {request}")
            else:
                logger.warning("Protobuf解码结果为空")
                request = {'operation': 'UNKNOWN'}
                
            return request
            
        except Exception as e:
            logger.error(f"Protobuf解码失败: {e}")
            # 返回默认响应而不是错误，避免连接中断
            return {
                'operation': 'PING',  # 使用PING作为安全的默认操作
                'message': f'Decode error: {str(e)}'
            }

    def build_response_frame(self, command: int, format_type: int, data: Dict, sequence: int) -> bytes:
        """构建Protobuf响应帧"""
        # 使用真实的 protobuf 二进制编码（自实现最小编码器）
        if isinstance(data, dict):
            try:
                data_bytes = self.encode_unified_response(data)
            except Exception as e:
                logger.error(f"Protobuf响应编码失败，拒绝处理: {e}")
                raise ValueError(f"仅支持Protobuf格式，编码失败: {e}")
        else:
            data_bytes = data if isinstance(data, bytes) else str(data).encode('utf-8')

        data_length = len(data_bytes)

        # 构建帧
        frame = bytearray()
        # 修复：使用真实魔数字节 0xAA 0x55（此前误用 ASCII 文本 "\\xAA\\x55"）
        frame.extend(b'\xAA\x55')  # 魔数
        frame.extend(struct.pack('<I', data_length))  # 数据长度（4字节）
        frame.extend(struct.pack('<H', sequence))  # 序列号
        frame.append(command)  # 命令码
        frame.append(format_type)  # 数据格式
        frame.extend(data_bytes)  # 数据体

        # 计算CRC8
        crc_data = frame[2:]
        crc8 = self.calculate_crc8(crc_data)
        frame.append(crc8)

        # 添加帧尾
        frame.append(0x55)
        frame.append(0xAA)

        return bytes(frame)

    # =====================
    # Protobuf 最小编码器
    # =====================

    def _varint(self, value: int) -> bytes:
        """编码无符号 varint"""
        if value < 0:
            # 仅处理非负数场景
            value &= (1 << 64) - 1
        out = bytearray()
        while True:
            to_write = value & 0x7F
            value >>= 7
            if value:
                out.append(to_write | 0x80)
            else:
                out.append(to_write)
                break
        return bytes(out)

    def _key(self, field_number: int, wire_type: int) -> bytes:
        return self._varint((field_number << 3) | wire_type)

    def _encode_bool(self, field_number: int, value: bool) -> bytes:
        return self._key(field_number, 0) + self._varint(1 if value else 0)

    def _encode_int(self, field_number: int, value: int) -> bytes:
        return self._key(field_number, 0) + self._varint(int(value))

    def _encode_string(self, field_number: int, value: str) -> bytes:
        data = value.encode('utf-8')
        return self._key(field_number, 2) + self._varint(len(data)) + data

    def _encode_bytes(self, field_number: int, data: bytes) -> bytes:
        return self._key(field_number, 2) + self._varint(len(data)) + data

    def _encode_message(self, field_number: int, message_bytes: bytes) -> bytes:
        return self._key(field_number, 2) + self._varint(len(message_bytes)) + message_bytes

    def _encode_server_info(self, si: Dict[str, Any]) -> bytes:
        b = bytearray()
        if si.get('name'):
            b += self._encode_string(1, si['name'])
        if si.get('version'):
            b += self._encode_string(2, si['version'])
        if si.get('protocol'):
            b += self._encode_string(3, si['protocol'])
        # supportedFormats: repeated string -> field 4
        for fmt in si.get('supportedFormats', []) or []:
            b += self._encode_string(4, str(fmt))
        if si.get('rootDir'):
            b += self._encode_string(5, si['rootDir'])
        if si.get('maxFileSize') is not None:
            b += self._encode_int(6, int(si['maxFileSize']))
        if si.get('chunkSize') is not None:
            b += self._encode_int(7, int(si['chunkSize']))
        if si.get('concurrentOperations') is not None:
            b += self._encode_int(8, int(si['concurrentOperations']))
        return bytes(b)

    def _encode_file_info(self, fi: Dict[str, Any]) -> bytes:
        b = bytearray()
        if fi.get('name'):
            b += self._encode_string(1, fi['name'])
        if fi.get('path'):
            b += self._encode_string(2, fi['path'])
        if fi.get('type'):
            b += self._encode_string(3, fi['type'])
        if fi.get('size') is not None:
            b += self._encode_int(4, int(fi['size']))
        if fi.get('lastModified'):
            b += self._encode_string(5, fi['lastModified'])
        if fi.get('permissions'):
            b += self._encode_string(6, fi['permissions'])
        if fi.get('isReadonly') is not None:
            b += self._encode_bool(7, bool(fi['isReadonly']))
        if fi.get('mimeType'):
            b += self._encode_string(8, fi['mimeType'])
        return bytes(b)

    def encode_unified_response(self, resp: Dict[str, Any]) -> bytes:
        """将字典编码为 UnifiedResponse 的 protobuf 二进制"""
        b = bytearray()

        # 1: success (bool)
        if resp.get('success') is not None:
            b += self._encode_bool(1, bool(resp['success']))

        # 2: message (string)
        if resp.get('message'):
            b += self._encode_string(2, str(resp['message']))

        # 3: files (repeated FileInfo message)
        files = resp.get('files') or []
        for f in files:
            fi_bytes = self._encode_file_info(f)
            b += self._encode_message(3, fi_bytes)

        # 4: data (bytes)
        if resp.get('data') is not None:
            data_val = resp['data']
            if isinstance(data_val, str):
                # 可能是 base64 字符串
                try:
                    data_bytes = base64.b64decode(data_val)
                except Exception:
                    data_bytes = data_val.encode('utf-8')
            elif isinstance(data_val, bytes):
                data_bytes = data_val
            else:
                # 兜底：转为 JSON 字节
                data_bytes = json.dumps(data_val, ensure_ascii=False).encode('utf-8')
            b += self._encode_bytes(4, data_bytes)

        # 5: isChunk (bool)
        if resp.get('isChunk') is not None:
            b += self._encode_bool(5, bool(resp['isChunk']))

        # 6: chunkIndex (int32)
        if resp.get('chunkIndex') is not None:
            b += self._encode_int(6, int(resp['chunkIndex']))

        # 7: totalChunks (int32)
        if resp.get('totalChunks') is not None:
            b += self._encode_int(7, int(resp['totalChunks']))

        # 8: chunkHash (string)
        if resp.get('chunkHash'):
            b += self._encode_string(8, str(resp['chunkHash']))

        # 9: processTimeMs (int64)
        if resp.get('processTimeMs') is not None:
            b += self._encode_int(9, int(resp['processTimeMs']))

        # 10: fileSize (int64)
        if resp.get('fileSize') is not None:
            b += self._encode_int(10, int(resp['fileSize']))

        # 11: progressPercent (int32)
        if resp.get('progressPercent') is not None:
            b += self._encode_int(11, int(resp['progressPercent']))

        # 12: status (string)
        if resp.get('status'):
            b += self._encode_string(12, str(resp['status']))

        # 13: selectedFormat (string)
        if resp.get('selectedFormat'):
            b += self._encode_string(13, str(resp['selectedFormat']))

        # 14: supportedCommands (repeated string)
        for cmd in resp.get('supportedCommands', []) or []:
            b += self._encode_string(14, str(cmd))

        # 15: serverInfo (message)
        if resp.get('serverInfo'):
            si_bytes = self._encode_server_info(resp['serverInfo'])
            b += self._encode_message(15, si_bytes)

        # 16: timestamp (int64)
        if resp.get('timestamp') is not None:
            b += self._encode_int(16, int(resp['timestamp']))

        # 17: sessionId (string)
        if resp.get('sessionId'):
            b += self._encode_string(17, str(resp['sessionId']))

        # 18: acceptedChunkSize (int32)
        if resp.get('acceptedChunkSize') is not None:
            b += self._encode_int(18, int(resp['acceptedChunkSize']))

        return bytes(b)

    def process_frame_request(self, command: int, request: Dict) -> Dict:
        """处理帧协议请求"""
        # 命令映射
        command_map = {
            self.CMD_CONNECT: 'CONNECT',
            self.CMD_DISCONNECT: 'DISCONNECT',
            self.CMD_PING: 'ping',
            self.CMD_LIST_FILES: 'list_files',
            self.CMD_FILE_INFO: 'file_info',
            self.CMD_DOWNLOAD_FILE: 'download_file',
            self.CMD_UPLOAD_FILE: 'upload_file',
            self.CMD_DELETE_FILE: 'delete_file',
            self.CMD_RENAME_FILE: 'rename_file',
            self.CMD_CREATE_DIR: 'create_directory',
            self.CMD_DOWNLOAD_REQ: 'download_req'
        }

        operation = command_map.get(command, '')

        # 添加operation字段
        if 'operation' not in request:
            request['operation'] = operation

        # 处理CONNECT命令
        if command == self.CMD_CONNECT:
            return self.handle_connect(request)

        # 处理其他请求
        return self.process_request(request)

    def handle_connect(self, request: Dict) -> Dict:
        """处理CONNECT请求 - 强制Protobuf格式"""
        logger.info(f"处理CONNECT请求: {request}")

        client_id = request.get('clientId', 'unknown')
        version = request.get('version', '1.0')

        logger.info(f"[CONNECT] 客户端连接请求:")
        logger.info(f"  - 客户端ID: {client_id}")
        logger.info(f"  - 协议版本: {version}")
        logger.info(f"  - 服务器格式: 仅支持Protobuf")

        return {
            'success': True,
            'message': 'Connected successfully (Protobuf-only)',
            'selectedFormat': 'protobuf',  # 强制返回protobuf
            'serverInfo': {
                'name': 'Protobuf TCP File Server',
                'version': '2.0.0',
                'protocol': 'Protobuf over TCP',
                'supportedFormats': ['protobuf'],  # 仅支持protobuf
                'rootDir': str(self.root_dir),
                'maxFileSize': 100 * 1024 * 1024,  # 100MB
                'chunkSize': 64 * 1024,  # 64KB
            },
            'timestamp': int(time.time() * 1000)
        }

    def handle_disconnect(self, request: Dict) -> Dict:
        """处理DISCONNECT请求 - 优雅断开连接"""
        logger.info(f"处理DISCONNECT请求: {request}")
        
        client_id = request.get('clientId', 'unknown')
        
        logger.info(f"[DISCONNECT] 客户端断开连接请求:")
        logger.info(f"  - 客户端ID: {client_id}")
        
        # 清理该客户端的所有会话数据
        # 注意：实际的socket关闭将在handle_client函数中处理
        return {
            'success': True,
            'message': 'Disconnected successfully',
            'timestamp': int(time.time() * 1000)
        }

    def get_command_name(self, command: int) -> str:
        """获取命令名称"""
        commands = {
            1: 'PING', 2: 'PONG', 3: 'CONNECT', 4: 'DISCONNECT',
            16: 'LIST_FILES', 17: 'FILE_INFO', 18: 'CREATE_DIR',
            19: 'DELETE_FILE', 20: 'RENAME_FILE',
            32: 'UPLOAD_FILE', 33: 'DOWNLOAD_FILE',
            48: 'UPLOAD_REQ', 49: 'UPLOAD_DATA', 50: 'UPLOAD_END',
            51: 'DOWNLOAD_REQ', 52: 'DOWNLOAD_DATA', 53: 'DOWNLOAD_END'
        }
        return commands.get(command, f'UNKNOWN({command})')

    def process_request(self, request: Dict) -> Dict:
        """处理请求"""
        start_time = time.time()
        operation = request.get('operation', '')

        try:
            operation_lower = operation.lower()

            if operation_lower == 'ping':
                response = self.handle_ping(request)
            elif operation in ['LIST_FILES', 'list_files']:
                response = self.handle_list_files(request)
            elif operation in ['FILE_INFO', 'file_info']:
                response = self.handle_file_info(request)
            elif operation in ['DOWNLOAD_FILE', 'download_file']:
                response = self.handle_download_file(request)
            elif operation in ['DOWNLOAD_REQ', 'download_req']:
                response = self.handle_download_req(request)
            elif operation in ['UPLOAD_FILE', 'upload_file']:
                response = self.handle_upload_file(request)
            elif operation in ['DELETE_FILE', 'delete_file']:
                response = self.handle_delete_file(request)
            elif operation in ['RENAME_FILE', 'rename_file']:
                response = self.handle_rename_file(request)
            elif operation in ['CREATE_DIR', 'create_directory']:
                response = self.handle_create_directory(request)
            elif operation == 'UPLOAD_REQ':
                response = self.handle_upload_req(request)
            elif operation == 'UPLOAD_DATA':
                response = self.handle_upload_data(request)
            elif operation == 'UPLOAD_END':
                response = self.handle_upload_end(request)
            elif operation == 'DISCONNECT':
                response = self.handle_disconnect(request)
            else:
                response = {
                    'success': False,
                    'message': f'不支持的操作: {operation}'
                }

            # 添加处理时间
            process_time = int((time.time() - start_time) * 1000)
            response['processTimeMs'] = process_time
            response['timestamp'] = int(time.time() * 1000)

            return response

        except Exception as e:
            logger.error(f"处理操作 {operation} 失败: {e}")
            return {
                'success': False,
                'message': f'操作失败: {str(e)}',
                'processTimeMs': int((time.time() - start_time) * 1000),
                'timestamp': int(time.time() * 1000)
            }

    def handle_ping(self, request: Dict) -> Dict:
        """处理ping请求"""
        return {
            'success': True,
            'message': 'pong',
            'serverInfo': {
                'name': 'Protobuf TCP文件服务器',
                'version': '2.0.0',
                'protocol': 'Protobuf over TCP',
                'rootDir': str(self.root_dir)
            }
        }

    def handle_list_files(self, request: Dict) -> Dict:
        """处理文件列表请求"""
        try:
            path = request.get('path', '/')
            target_path = self.get_safe_path(path)

            if not target_path.exists():
                return {'success': False, 'message': f'路径不存在: {path}'}

            if not target_path.is_dir():
                return {'success': False, 'message': f'不是目录: {path}'}

            files = []
            for item in sorted(target_path.iterdir()):
                try:
                    stat = item.stat()
                    relative_path = '/' + str(item.relative_to(self.root_dir)).replace('\\\\', '/')

                    file_info = {
                        'name': item.name,
                        'path': relative_path,
                        'type': 'directory' if item.is_dir() else 'file',
                        'size': stat.st_size if item.is_file() else 0,
                        'lastModified': datetime.fromtimestamp(stat.st_mtime).isoformat() + 'Z',
                        'permissions': oct(stat.st_mode)[-3:],
                        'isReadonly': not os.access(item, os.W_OK)
                    }
                    files.append(file_info)

                except Exception as e:
                    logger.warning(f"获取文件信息失败 {item}: {e}")

            logger.info(f"列出目录 {path}: {len(files)} 个文件")
            return {
                'success': True,
                'message': f'列出 {len(files)} 个文件',
                'files': files,
                'path': path
            }

        except Exception as e:
            return {'success': False, 'message': f'列表操作失败: {str(e)}'}

    def handle_file_info(self, request: Dict) -> Dict:
        """处理文件信息请求，返回单个文件的详细信息"""
        try:
            file_path = request.get('path', '')
            if not file_path:
                return {'success': False, 'message': '缺少文件路径参数'}

            target_path = self.get_safe_path(file_path)

            if not target_path.exists():
                return {'success': False, 'message': f'文件不存在: {file_path}'}

            if not target_path.is_file():
                return {'success': False, 'message': f'不是文件: {file_path}'}

            stat = target_path.stat()
            file_size = stat.st_size
            last_modified = datetime.fromtimestamp(stat.st_mtime).isoformat() + 'Z'

            file_info = {
                'name': target_path.name,
                'path': '/' + str(target_path.relative_to(self.root_dir)).replace('\\', '/'),
                'type': 'file',
                'size': file_size,
                'lastModified': last_modified,
                'permissions': oct(stat.st_mode)[-3:],
                'isReadonly': not os.access(target_path, os.W_OK),
                'mimeType': 'application/octet-stream'
            }

            logger.info(f"[FILE_INFO] {file_path} 大小 {file_size} 字节")

            return {
                'success': True,
                'message': '文件信息获取成功',
                'fileSize': file_size,
                'files': [file_info]
            }

        except Exception as e:
            logger.error(f"获取文件信息失败: {e}")
            return {'success': False, 'message': f'文件信息获取失败: {str(e)}'}

    def handle_download_file(self, request: Dict) -> Dict:
        """处理文件下载请求"""
        try:
            file_path = request.get('path', '')
            if not file_path:
                return {'success': False, 'message': '缺少文件路径参数'}

            target_path = self.get_safe_path(file_path)

            if not target_path.exists():
                return {'success': False, 'message': f'文件不存在: {file_path}'}

            if not target_path.is_file():
                return {'success': False, 'message': f'不是文件: {file_path}'}

            # 读取文件内容（直接返回原始二进制数据）
            with open(target_path, 'rb') as f:
                file_data = f.read()

            logger.info(f"下载文件: {file_path} ({len(file_data)} 字节，原始二进制模式)")

            if len(file_data) > DEFAULT_STREAM_CHUNK_BYTES:
                logger.warning(
                    "[DOWNLOAD_FILE] 请求的文件大于帧限制，建议改用 DOWNLOAD_REQ 分块接口"
                )
            return {
                'success': True,
                'message': f'文件下载成功: {target_path.name}',
                'filename': target_path.name,
                'data': file_data,
                'fileSize': len(file_data),
                'mimeType': 'application/octet-stream'
            }

        except Exception as e:
            return {'success': False, 'message': f'文件下载失败: {str(e)}'}

    def handle_download_req(self, request: Dict) -> Dict:
        """处理流式下载: start/chunk/finish/abort"""
        try:
            client_id = request.get('__client_id', 'unknown')
            file_path = request.get('path', '')
            if not file_path:
                return {'success': False, 'message': '缺少文件路径参数'}

            target_path = self.get_safe_path(file_path)

            if not target_path.exists():
                return {'success': False, 'message': f'文件不存在: {file_path}'}

            if not target_path.is_file():
                return {'success': False, 'message': f'不是文件: {file_path}'}

            options = request.get('options', {}) or {}
            action = options.get('action') or request.get('action')

            if not action:
                return {'success': False, 'message': '缺少下载动作参数'}

            session_hint = options.get('sessionId') or request.get('sessionId')
            chunk_hint = options.get('chunkIndex') or request.get('chunkIndex')
            logger.info(
                f"[DOWNLOAD_REQ] 收到请求: action={action}, path={file_path}, session={session_hint or 'N/A'}, chunk={chunk_hint if chunk_hint is not None else 'N/A'}, client={client_id}"
            )

            if action == 'start':
                requested_chunk = options.get('chunkSize') or request.get('chunkSize')

                def _to_int(value, default=DEFAULT_STREAM_CHUNK_BYTES):
                    try:
                        return int(value)
                    except (TypeError, ValueError):
                        return default

                chunk_bytes = max(
                    MIN_STREAM_CHUNK_BYTES,
                    min(_to_int(requested_chunk, DEFAULT_STREAM_CHUNK_BYTES), MAX_STREAM_CHUNK_BYTES)
                )

                file_size = target_path.stat().st_size
                total_chunks = max(1, (file_size + chunk_bytes - 1) // chunk_bytes)
                session_id = f"dl_{int(time.time() * 1000)}_{target_path.name}"

                self.download_sessions[session_id] = {
                    'path': file_path,
                    'absolutePath': target_path,
                    'fileSize': file_size,
                    'chunkSize': chunk_bytes,
                    'totalChunks': total_chunks,
                    'nextChunk': 0,
                    'bytesSent': 0,
                    'startTime': time.time(),
                    'clientId': client_id,
                    'servedChunks': set()
                }

                logger.info(f"[DOWNLOAD_REQ] 启动流式下载: {file_path}")
                logger.info(f"  - 会话ID: {session_id}")
                logger.info(f"  - 文件大小: {file_size}")
                logger.info(f"  - 块大小: {chunk_bytes}")
                logger.info(f"  - 总块数: {total_chunks}")

                return {
                    'success': True,
                    'message': '下载会话已创建',
                    'sessionId': session_id,
                    'acceptedChunkSize': chunk_bytes,
                    'totalChunks': total_chunks,
                    'fileSize': file_size,
                    'supportsResume': True
                }

            if action == 'chunk':
                session_id = options.get('sessionId') or request.get('sessionId')
                if not session_id or session_id not in self.download_sessions:
                    logger.warning(f"[DOWNLOAD_REQ] 分块请求的会话不存在: {session_id}")
                    return {'success': False, 'message': '下载会话不存在或已结束'}

            session = self.download_sessions[session_id]
            chunk_size = session['chunkSize']
            file_size = session['fileSize']
            total_chunks = session['totalChunks']
            absolute_path = session['absolutePath']

            def _to_int(value, default):
                try:
                    return int(value)
                except (TypeError, ValueError):
                    return default

            requested_index = _to_int(request.get('chunkIndex') or options.get('chunkIndex'), session['nextChunk'])

            if requested_index < 0 or requested_index >= total_chunks:
                return {
                    'success': False,
                    'message': f'分块序号超出范围: {requested_index}/{total_chunks}'
                }

            start_offset = requested_index * chunk_size
            logger.debug(
                f"[DOWNLOAD_REQ] 准备分块: session={session_id}, chunk={requested_index + 1}/{total_chunks}, offset={start_offset}, requestSize={chunk_size}"
            )
            with open(absolute_path, 'rb', buffering=0) as file_handle:
                file_handle.seek(start_offset)
                chunk_data = file_handle.read(chunk_size)

            if not chunk_data:
                logger.warning(
                    f"[DOWNLOAD_REQ] 会话 {session_id} 读取到空数据块 (offset={start_offset})，判定为EOF"
                )
                return {
                    'success': True,
                    'message': '已达文件末尾',
                    'data': b'',
                    'fileSize': file_size,
                    'chunkIndex': requested_index,
                    'totalChunks': total_chunks,
                    'sessionId': session_id,
                    'done': True
                }

            if requested_index not in session['servedChunks']:
                session['servedChunks'].add(requested_index)
                session['bytesSent'] += len(chunk_data)

            session['nextChunk'] = max(session['nextChunk'], requested_index + 1)

            progress_interval = max(1, total_chunks // 10) if total_chunks > 0 else 1
            percent = (session['bytesSent'] / file_size * 100) if file_size else 0.0

            if requested_index == 0:
                logger.info(
                    f"[DOWNLOAD_REQ] 首块发送完成: session={session_id}, size={len(chunk_data)}, 累计={session['bytesSent']} ({percent:.2f}% )"
                )
            elif len(session['servedChunks']) == total_chunks:
                logger.info(
                    f"[DOWNLOAD_REQ] 最后一块发送完成: session={session_id}, chunk={requested_index + 1}/{total_chunks}, size={len(chunk_data)}, 累计={session['bytesSent']} ({percent:.2f}% )"
                )
            elif len(session['servedChunks']) % progress_interval == 0:
                logger.info(
                    f"[DOWNLOAD_REQ] 进度: session={session_id}, chunk={requested_index + 1}/{total_chunks}, size={len(chunk_data)}, 累计={session['bytesSent']} ({percent:.2f}% )"
                )
            else:
                logger.debug(
                    f"[DOWNLOAD_REQ] 分块发送: session={session_id}, chunk={requested_index + 1}/{total_chunks}, size={len(chunk_data)}, offset={start_offset}"
                )

            return {
                'success': True,
                'message': '块获取成功',
                'data': chunk_data,
                'fileSize': file_size,
                'chunkIndex': requested_index,
                'totalChunks': total_chunks,
                'sessionId': session_id
            }

            if action == 'finish':
                session_id = options.get('sessionId') or request.get('sessionId')
                if not session_id or session_id not in self.download_sessions:
                    logger.warning(f"[DOWNLOAD_REQ] 完成请求的会话不存在: {session_id}")
                    return {'success': False, 'message': '下载会话不存在或已结束'}

                logger.info(f"[DOWNLOAD_REQ] 收到完成请求: session={session_id}")
                session = self.download_sessions.pop(session_id)

                duration = time.time() - session['startTime']
                avg_speed = session['bytesSent'] / duration if duration > 0 else session['bytesSent']

                logger.info(f"[DOWNLOAD_REQ] 会话 {session_id} 下载完成")
                logger.info(f"  - 文件: {session['path']}")
                logger.info(f"  - 字节: {session['bytesSent']}/{session['fileSize']}")
                logger.info(f"  - 耗时: {duration:.2f}s")
                logger.info(f"  - 平均速度: {avg_speed / 1024:.2f} KB/s")

                return {
                    'success': True,
                    'message': '下载完成',
                    'bytesSent': session['bytesSent'],
                    'fileSize': session['fileSize']
                }

            if action == 'abort':
                session_id = options.get('sessionId') or request.get('sessionId')
                if session_id and session_id in self.download_sessions:
                    session = self.download_sessions.pop(session_id)
                    bytes_sent = session.get('bytesSent', 0)
                    total_size = session.get('fileSize')
                    size_display = f"{bytes_sent}/{total_size}" if total_size else str(bytes_sent)
                    logger.info(
                        f"[DOWNLOAD_REQ] 会话 {session_id} 已中止，累计发送 {size_display} 字节"
                    )
                else:
                    logger.warning(f"[DOWNLOAD_REQ] 中止请求的会话不存在: {session_id}")
                return { 'success': True, 'message': '下载会话已中止' }

            return {
                'success': False,
                'message': f'未知的下载动作: {action}'
            }

        except Exception as e:
            logger.error(f"分块下载失败: {e}")
            return {'success': False, 'message': f'分块下载失败: {str(e)}'}

    def handle_upload_file(self, request: Dict) -> Dict:
        """处理文件上传请求"""
        try:
            target_path = request.get('path', '/')
            filename = request.get('filename', '') or request.get('name', '')
            file_data_b64 = request.get('data', '')

            if not filename:
                return {'success': False, 'message': '缺少文件名参数'}

            if not file_data_b64:
                return {'success': False, 'message': '缺少文件数据参数'}

            # 解码base64数据
            try:
                file_data = base64.b64decode(file_data_b64)
            except Exception as e:
                return {'success': False, 'message': f'文件数据解码失败: {str(e)}'}

            # 构建目标路径
            if target_path == '/':
                full_path = self.root_dir / filename
            else:
                dir_path = self.get_safe_path(target_path)
                full_path = dir_path / filename

            # 确保目标目录存在
            full_path.parent.mkdir(parents=True, exist_ok=True)

            # 写入文件
            with open(full_path, 'wb') as f:
                f.write(file_data)

            logger.info(f"上传文件: {filename} 到 {target_path} ({len(file_data)} 字节)")
            return {
                'success': True,
                'message': f'文件上传成功: {filename}',
                'filename': filename,
                'path': target_path,
                'fileSize': len(file_data)
            }

        except Exception as e:
            return {'success': False, 'message': f'文件上传失败: {str(e)}'}

    def handle_delete_file(self, request: Dict) -> Dict:
        """处理文件删除请求"""
        try:
            file_path = request.get('path', '')
            if not file_path:
                return {'success': False, 'message': '缺少文件路径参数'}

            target_path = self.get_safe_path(file_path)

            if not target_path.exists():
                return {'success': False, 'message': f'文件或目录不存在: {file_path}'}

            if target_path.is_file():
                target_path.unlink()
                file_type = "文件"
            elif target_path.is_dir():
                shutil.rmtree(target_path)
                file_type = "目录"
            else:
                return {'success': False, 'message': f'未知文件类型: {file_path}'}

            logger.info(f"删除{file_type}: {file_path}")
            return {
                'success': True,
                'message': f'{file_type}删除成功: {target_path.name}',
                'type': file_type.lower()
            }

        except Exception as e:
            return {'success': False, 'message': f'删除失败: {str(e)}'}

    def handle_rename_file(self, request: Dict) -> Dict:
        """处理文件重命名请求"""
        try:
            old_path = request.get('path', '')
            new_name = request.get('newName', '')
            new_path = request.get('newPath', '')

            if not new_path:
                options = request.get('options', {}) or {}
                new_path = options.get('newPath') or options.get('targetPath') or options.get('destinationPath') or ''

            if not old_path:
                return {'success': False, 'message': '缺少源文件路径参数'}

            source_path = self.get_safe_path(old_path)

            if not source_path.exists():
                return {'success': False, 'message': f'源文件不存在: {old_path}'}

            # 构建新路径
            if new_path:
                target_path = self.get_safe_path(new_path)
                target_display = new_path
            else:
                if not new_name:
                    return {'success': False, 'message': '缺少新文件名参数'}
                target_path = source_path.parent / new_name
                target_display = new_name

            target_parent = target_path.parent
            if not target_parent.exists():
                parent_display = '/' if target_parent == self.root_dir else '/' + str(target_parent.relative_to(self.root_dir)).replace('\\', '/')
                return {'success': False, 'message': f'目标目录不存在: {parent_display}'}

            if target_path.exists():
                return {'success': False, 'message': f'目标文件已存在: {target_path.name}'}

            # 执行重命名
            source_path.rename(target_path)

            logger.info(f"重命名/移动: {old_path} -> {target_display}")
            return {
                'success': True,
                'message': f'重命名成功: {source_path.name} -> {target_path.name}',
                'oldName': source_path.name,
                'newName': target_path.name,
                'newPath': '/' + str(target_path.relative_to(self.root_dir)).replace('\\\\', '/')
            }

        except Exception as e:
            return {'success': False, 'message': f'重命名失败: {str(e)}'}

    def handle_create_directory(self, request: Dict) -> Dict:
        """处理目录创建请求"""
        try:
            parent_path = request.get('path', '/')
            dir_name = request.get('name', '')

            if not dir_name:
                return {'success': False, 'message': '缺少目录名参数'}

            if parent_path == '/':
                target_path = self.root_dir / dir_name
            else:
                parent_dir = self.get_safe_path(parent_path)
                target_path = parent_dir / dir_name

            if target_path.exists():
                return {'success': False, 'message': f'目录已存在: {dir_name}'}

            # 创建目录
            target_path.mkdir(parents=True, exist_ok=False)

            logger.info(f"创建目录: {dir_name} 在 {parent_path}")
            return {
                'success': True,
                'message': f'目录创建成功: {dir_name}',
                'name': dir_name,
                'path': parent_path
            }

        except Exception as e:
            return {'success': False, 'message': f'目录创建失败: {str(e)}'}
    
    def handle_upload_req(self, request: Dict) -> Dict:
        """处理分块上传请求初始化"""
        try:
            path = request.get('path', '/')
            filename = request.get('name', '')
            file_size = request.get('fileSize', 0)
            chunk_size = min(request.get('chunkSize', 65536), 4 * 1024 * 1024)
            total_chunks = request.get('totalChunks', 0)
            options = request.get('options', {})
            
            if not filename:
                return {
                    'success': False,
                    'message': '缺少文件名参数'
                }
            
            # 使用客户端提供的 sessionId，如果没有则生成新的
            client_session_id = options.get('sessionId', '')
            if client_session_id:
                session_id = client_session_id
                logger.info(f"[UPLOAD_REQ] 使用客户端会话ID: {session_id}")
            else:
                # 生成新的会话ID
                session_id = f"{int(time.time() * 1000)}_{filename}"
                logger.info(f"[UPLOAD_REQ] 生成新会话ID: {session_id}")

            # 如存在旧会话残留，确保释放资源
            existing_session = self.upload_sessions.pop(session_id, None)
            if existing_session:
                handle = existing_session.get('handle')
                if handle:
                    try:
                        handle.close()
                    except Exception as close_error:
                        logger.warning(f"[UPLOAD_REQ] 关闭旧会话句柄失败: {close_error}")
            
            # 计算实际目标路径
            if path == '/':
                target_dir = self.root_dir
            else:
                target_dir = self.get_safe_path(path)

            full_path = (target_dir / filename).resolve()
            full_path.parent.mkdir(parents=True, exist_ok=True)

            # 预创建文件并扩展到目标大小，避免后续重新分配
            with open(full_path, 'wb') as f:
                if file_size > 0:
                    f.truncate(file_size)

            file_handle = open(full_path, 'r+b')

            if total_chunks <= 0 and chunk_size > 0:
                total_chunks = max(1, (file_size + chunk_size - 1) // chunk_size)

            # 创建上传会话
            self.upload_sessions[session_id] = {
                'path': path,
                'filename': filename,
                'file_path': full_path,
                'total_chunks': total_chunks,
                'chunk_size': chunk_size,
                'file_size': file_size,
                'start_time': time.time(),
                'last_activity': time.time(),
                'received_chunks': set(),
                'bytes_received': 0,
                'handle': file_handle
            }
            
            logger.info(f"[UPLOAD_REQ] 初始化分块上传: {filename}")
            logger.info(f"  - 会话ID: {session_id}")
            logger.info(f"  - 总块数: {total_chunks}")
            logger.info(f"  - 块大小: {chunk_size}")
            logger.info(f"  - 文件大小: {file_size}")
            
            return {
                'success': True,
                'message': '上传会话已创建',
                'sessionId': session_id,
                'acceptedChunkSize': chunk_size
            }
            
        except Exception as e:
            logger.error(f"创建上传会话失败: {e}")
            return {
                'success': False,
                'message': f'创建上传会话失败: {str(e)}'
            }
    
    def handle_upload_data(self, request: Dict) -> Dict:
        """处理分块上传数据"""
        try:
            # 获取会话ID
            options = request.get('options', {})
            session_id = options.get('sessionId', '')
            
            # 如果没有 sessionId，尝试使用最新的会话
            if not session_id:
                if not self.upload_sessions:
                    return {
                        'success': False,
                        'message': '没有活动的上传会话'
                    }
                # 获取最新的会话
                session_id = list(self.upload_sessions.keys())[-1]
                logger.warning(f"[UPLOAD_DATA] 客户端未提供 sessionId，使用最新会话: {session_id}")
            
            # 查找指定的会话
            if session_id not in self.upload_sessions:
                return {
                    'success': False,
                    'message': f'上传会话不存在: {session_id}'
                }
            
            session = self.upload_sessions[session_id]
            session['last_activity'] = time.time()  # 更新活动时间

            chunk_index = request.get('chunkIndex', 0)
            chunk_data = request.get('data', b'')
            total_chunks = request.get('totalChunks', session.get('total_chunks', 0))
            
            # 处理数据（支持直接二进制和base64）
            if isinstance(chunk_data, bytes):
                # 直接二进制数据（来自Protobuf）
                decoded_data = chunk_data
                if logger.level <= logging.DEBUG:
                    logger.debug(f"[UPLOAD_DATA] 接收到直接二进制数据: {len(decoded_data)} 字节")
            elif isinstance(chunk_data, str) and chunk_data:
                # base64编码的数据（来自JSON）
                try:
                    decoded_data = base64.b64decode(chunk_data)
                    if logger.level <= logging.DEBUG:
                        logger.debug(f"[UPLOAD_DATA] base64解码成功: {len(chunk_data)} -> {len(decoded_data)} 字节")
                except Exception as e:
                    return {
                        'success': False,
                        'message': f'数据解码失败: {str(e)}'
                    }
            else:
                return {
                    'success': False,
                    'message': '缺少有效的数据块内容'
                }
            
            # 计算写入偏移
            offset = chunk_index * session['chunk_size']
            file_handle = session.get('handle')
            if not file_handle:
                file_handle = open(session['file_path'], 'r+b')
                session['handle'] = file_handle

            file_handle.seek(offset)
            file_handle.write(decoded_data)

            # 更新会话元数据
            was_received = chunk_index in session['received_chunks']
            session['received_chunks'].add(chunk_index)
            if not was_received:
                session['bytes_received'] += len(decoded_data)

            # 减少日志输出，只在关键时刻输出
            if chunk_index == 0 or (chunk_index + 1) % 10 == 0 or chunk_index == total_chunks - 1:
                logger.info(f"[UPLOAD_DATA] 接收数据块 {chunk_index + 1}/{total_chunks} (会话: {session_id}, 大小: {len(decoded_data)} 字节, 偏移: {offset})")
                logger.info(f"  - 已接收: {len(session['received_chunks'])}/{total_chunks}")
            elif logger.level <= logging.DEBUG:
                logger.debug(f"[UPLOAD_DATA] 接收数据块 {chunk_index + 1}/{total_chunks} (大小: {len(decoded_data)} 字节, 偏移: {offset})")

            return {
                'success': True,
                'message': f'数据块 {chunk_index} 接收成功',
                'sessionId': session_id,
                'chunkIndex': chunk_index,
                'receivedChunks': len(session['received_chunks']),
                'totalChunks': total_chunks
            }
            
        except Exception as e:
            logger.error(f"接收数据块失败: {e}")
            return {
                'success': False,
                'message': f'接收数据块失败: {str(e)}'
            }
    
    def handle_upload_end(self, request: Dict) -> Dict:
        """处理分块上传结束"""
        try:
            # 获取会话ID
            options = request.get('options', {})
            session_id = options.get('sessionId', '')
            
            # 如果没有 sessionId，尝试使用最新的会话
            if not session_id:
                if not self.upload_sessions:
                    return {
                        'success': False,
                        'message': '没有活动的上传会话'
                    }
                # 获取最新的会话
                session_id = list(self.upload_sessions.keys())[-1]
                logger.warning(f"[UPLOAD_END] 客户端未提供 sessionId，使用最新会话: {session_id}")
            
            # 查找指定的会话
            if session_id not in self.upload_sessions:
                return {
                    'success': False,
                    'message': f'上传会话不存在: {session_id}'
                }
            
            session = self.upload_sessions[session_id]
            
            total_chunks = session.get('total_chunks', 0)
            expected_file_size = session.get('file_size', 0)

            logger.info(f"[UPLOAD_END] 开始完成上传 (会话: {session_id})")
            logger.info(f"  - 期望块数: {total_chunks}")
            logger.info(f"  - 实际接收: {len(session['received_chunks'])}")
            logger.info(f"  - 期望文件大小: {expected_file_size}")

            # 检查块的完整性
            missing_chunks = []
            for i in range(total_chunks):
                if i not in session['received_chunks']:
                    missing_chunks.append(i)

            if missing_chunks:
                logger.error(f"[UPLOAD_END] 缺少数据块: {missing_chunks}")
                return {
                    'success': False,
                    'message': f'缺少数据块: {missing_chunks[:10]}...' if len(missing_chunks) > 10 else f'缺少数据块: {missing_chunks}'
                }
            
            # 确保句柄刷新后再校验
            file_handle = session.get('handle')
            if file_handle:
                try:
                    file_handle.flush()
                finally:
                    try:
                        file_handle.close()
                    except Exception as close_error:
                        logger.warning(f"[UPLOAD_END] 关闭文件句柄失败: {close_error}")
                session['handle'] = None

            # 验证文件大小
            file_path = session['file_path']
            actual_size = file_path.stat().st_size if file_path.exists() else 0
            if expected_file_size > 0 and actual_size != expected_file_size:
                logger.error(f"[UPLOAD_END] 文件大小不匹配: 期望 {expected_file_size}, 实际 {actual_size}")
                return {
                    'success': False,
                    'message': f'文件大小不匹配: 期望 {expected_file_size}, 实际 {actual_size}'
                }

            # 计算上传时间和统计信息
            upload_time = time.time() - session['start_time']
            avg_speed = session['bytes_received'] / upload_time if upload_time > 0 else 0

            filename = session.get('filename', 'unknown')

            logger.info(f"[UPLOAD_END] 分块上传完成: {filename}")
            logger.info(f"  - 文件路径: {file_path}")
            logger.info(f"  - 文件大小: {actual_size} 字节")
            logger.info(f"  - 总块数: {total_chunks}")
            logger.info(f"  - 上传时间: {upload_time:.2f} 秒")
            logger.info(f"  - 平均速度: {avg_speed / 1024:.2f} KB/s")

            # 清理会话
            self.upload_sessions.pop(session_id, None)

            return {
                'success': True,
                'message': f'文件上传成功: {filename}',
                'filename': filename,
                'size': actual_size,
                'uploadTimeMs': int(upload_time * 1000)
            }
            
        except Exception as e:
            logger.error(f"完成上传失败: {e}")
            if session_id:
                session = self.upload_sessions.get(session_id)
                if session:
                    handle = session.get('handle')
                    if handle:
                        try:
                            handle.close()
                        except Exception as close_error:
                            logger.warning(f"[UPLOAD_END] 异常关闭句柄失败: {close_error}")
                    self.upload_sessions.pop(session_id, None)
            return {
                'success': False,
                'message': f'完成上传失败: {str(e)}'
            }

    def calculate_crc8(self, data: Iterable[int]) -> int:
        """使用查表法计算CRC8，显著降低大块数据的校验成本"""
        crc = 0
        for byte in data:
            crc = CRC8_TABLE[crc ^ byte]
        return crc

    def get_safe_path(self, path: str) -> Path:
        """获取安全的文件系统路径"""
        # 标准化路径
        if path.startswith('/'):
            path = path[1:]

        # 组合基础路径
        target_path = self.root_dir / path
        target_path = target_path.resolve()

        # 确保路径在根目录内
        if not str(target_path).startswith(str(self.root_dir)):
            raise ValueError(f"路径超出安全范围: {path}")

        return target_path


def main():
    """主函数"""
    parser = argparse.ArgumentParser(
        description='TCP Protobuf文件管理测试服务器',
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )

    parser.add_argument('--host', default='0.0.0.0',
                       help='服务器地址')
    parser.add_argument('--port', type=int, default=8765,
                       help='服务器端口')
    parser.add_argument('--path', default='tcp_test_root',
                       help='服务根目录')
    parser.add_argument('--debug', action='store_true',
                       help='启用调试日志')

    args = parser.parse_args()

    # 设置日志级别
    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)
    else:
        logging.getLogger().setLevel(logging.INFO)

    # 创建并启动服务器
    server = ProtobufTcpServer(
        host=args.host,
        port=args.port,
        root_dir=args.path
    )

    try:
        server.start()
    except KeyboardInterrupt:
        logger.info("\\n收到停止信号")
    except Exception as e:
        logger.error(f"服务器运行错误: {e}")
    finally:
        server.stop()
        logger.info("程序退出")
        return 0


if __name__ == '__main__':
    sys.exit(main())
