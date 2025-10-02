/**
 * FTP 优化功能测试套件主入口
 * 统一导入所有 FTP 相关的测试文件
 */

// 导入所有测试套件
import './FtpConnectionPool.test';
import './FtpCapabilityDetector.test';
import './StandardFtpOptimizer.test';
import './ExtendedFtpOptimizer.test';
import './CompatibleFtpClient.test';
import './FtpPerformanceService.test';

export * from './FtpConnectionPool.test';
export * from './FtpCapabilityDetector.test';
export * from './StandardFtpOptimizer.test';
export * from './ExtendedFtpOptimizer.test';
export * from './CompatibleFtpClient.test';
export * from './FtpPerformanceService.test';