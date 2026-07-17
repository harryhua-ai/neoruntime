import request from '@/services/request';
import type { DiskInfo } from '@/services/types';

export interface OTAParseResponse {
  current_version: string;
  target_version: string;
  build_date: string;
  git_commit: string;
  firmware_path: string;
  firmware_size: number;
}

export interface OTAStatusResponse {
  status: string;
  progress: number;
  message: string;
  current_step: string;
  version: string;
  start_time: number;
  error: string;
  reboot_needed: boolean;
}

export type OSUpgradeState =
  | 'idle'
  | 'uploading'
  | 'validating'
  | 'ready'
  | 'installing'
  | 'installed'
  | 'awaiting_reboot'
  | 'rebooting'
  | 'verifying'
  | 'success'
  | 'rollback'
  | 'failed'
  | 'cancelled';

export interface OSUpgradeStatus {
  job_id?: string;
  status: OSUpgradeState;
  progress?: number;
  message?: string;
  error?: string;
  file_name?: string;
  file_size?: number;
  sha256?: string;
  current_version?: string;
  target_version?: string;
  build_time?: string;
  machine?: string;
  product?: string;
  hardware_version?: string;
  current_copy?: string;
  target_copy?: string;
  upgrade_mode?: 'dual' | 'single-recovery';
  recovery_source?: 'bundled';
  recovery_version?: string;
  app_version?: string;
  compat_level?: number;
  data_schema?: number;
  compatibility_valid?: boolean;
  rollback_supported?: boolean;
  service_interruption_required?: boolean;
  downgrade_allowed?: boolean;
  signature_valid?: boolean;
  reboot_required?: boolean;
  log?: string;
}

// System API
export const systemApi = {
  // 获取系统信息
  getSystemInfo: () => request.get('/api/v1/system/info'),

  // 获取系统统计
  getSystemStats: () => request.get('/api/v1/system/stats'),

  // 健康检查
  healthCheck: (config?: Record<string, unknown>) => request.get('/api/v1/system/health', config),

  // 更改系统密码
  updatePassword: (data: { old_password?: string; new_password: string }) => request.post('/api/v1/system/password', data),

  // 系统重启（设备会断连，静默避免全局 Network Error 提示）
  restart: () => request.post('/api/v1/system/restart', undefined, { silent: true } as any),

  // 恢复出厂设置
  factoryReset: () => request.post('/api/v1/system/factory-reset'),

  // OTA 解析固件包
  otaParse: (file: File, onProgress?: (progress: number) => void) => {
    const formData = new FormData();
    formData.append('firmware', file);
    return request.post('/api/v1/system/ota/parse', formData, {
      onUploadProgress: progressEvent => {
        if (onProgress && progressEvent.total) {
          onProgress(
            Math.round((progressEvent.loaded * 100) / progressEvent.total)
          );
        }
      },
    });
  },

  // OTA 状态
  otaStatus: () => request.get<OTAStatusResponse>('/api/v1/system/ota/status'),

  // OTA 执行固件升级
  otaUpgrade: () => request.post('/api/v1/system/ota/install'),

  // OTA 使用 parse 返回的本地路径触发升级（设备可能断连，静默）
  otaInstallFromPath: (path: string) => request.post('/api/v1/system/ota/install-from-path', { path }, {
      silent: true,
    } as any),

  osUpgradeUpload: (file: File, onProgress?: (progress: number) => void) => {
    const formData = new FormData();
    formData.append('package', file);
    return request.post('/api/v1/system/os-upgrade/upload', formData, {
      timeout: 0,
      onUploadProgress: event => {
        if (onProgress && event.total) {
          onProgress(Math.round((event.loaded * 100) / event.total));
        }
      },
    });
  },

  osUpgradeValidate: (jobId: string) => request.post(
      '/api/v1/system/os-upgrade/validate',
      { job_id: jobId },
      { timeout: 0 }
    ),

  osUpgradeInstall: (jobId: string) => request.post('/api/v1/system/os-upgrade/install', { job_id: jobId }),

  osUpgradeStatus: (jobId?: string, silent = false) => request.get('/api/v1/system/os-upgrade/status', {
      params: jobId ? { job_id: jobId } : undefined,
      ...(silent ? { silent: true } : {}),
    } as any),

  osUpgradeReboot: (jobId: string) => request.post(
      '/api/v1/system/os-upgrade/reboot',
      { job_id: jobId },
      { silent: true }
    ),

  osUpgradeCancel: (jobId: string) => request.post('/api/v1/system/os-upgrade/cancel', { job_id: jobId }),

  osUpgradeDeletePackage: (jobId: string) => request.delete('/api/v1/system/os-upgrade/package', {
      data: { job_id: jobId },
    }),
};

// Monitor API
export const monitorApi = {
  // 获取监控摘要
  getSummary: () => request.get('/api/v1/monitor/summary'),

  // 获取 CPU 监控
  getCPU: () => request.get('/api/v1/monitor/cpu'),

  // 获取内存监控
  getMemory: () => request.get('/api/v1/monitor/memory'),

  // 获取磁盘监控
  getDisk: () => request.get<DiskInfo>('/api/v1/monitor/disk'),

  // 获取网络监控
  getNetwork: () => request.get('/api/v1/monitor/network'),

  // 获取资源快照 (dashboard trend chart)
  getSnapshot: () => request.get<{
      timestamp: number;
      cpu: number;
      memory: number;
      npu: number;
      temperatures: {
        cpu: number;
        npu: number;
        board: number;
      };
      network?: {
        bytes_sent: number;
        bytes_recv: number;
      };
    }>('/api/v1/monitor/snapshot'),
};

// Storage API
export const storageApi = {
  // 获取磁盘列表
  listDisks: () => request.get('/api/v1/storage/disks'),

  // 卸载磁盘
  unmountDisk: (target: string) => request.post('/api/v1/storage/unmount', { target }),

  // 格式化磁盘
  formatDisk: (device: string, fstype: 'ext4' | 'vfat' | 'fat32' = 'ext4') => request.post('/api/v1/storage/format', { device, fstype }),

  // 挂载磁盘
  mountDisk: (device: string, target?: string) => request.post('/api/v1/storage/mount', { device, target }),
};

// Process API
export const processApi = {
  // 获取进程列表
  listProcesses: (
    sort?: 'cpu' | 'mem' | 'pid',
    limit?: number,
    search?: string
  ) => request.get('/api/v1/processes', { params: { sort, limit, search } }),

  // 获取进程详情
  getProcessInfo: (pid: number) => request.get(`/api/v1/processes/${pid}`),

  // 终止进程
  killProcess: (
    pid: number,
    signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT' | 'SIGHUP'
  ) => request.post(`/api/v1/processes/${pid}/kill`, null, { params: { signal } }),
};
