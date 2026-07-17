import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import FileUpload from '@/components/file-upload';
import SystemLoadingMask from '@/components/system-loading-mask';
import { systemApi } from '@/services/api/system';
import { enterNetworkErrorToastSuppress } from '@/services/request';
import { startPolling, type PollingHandle } from '@/utils/polling';

export interface FirmwareUpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type MaskPhase =
  | 'uploading'
  | 'upgrading'
  | 'rebooting'
  | 'error'
  | 'timeout'
  | null;

export function FirmwareUpdateDialog({
  open,
  onOpenChange,
}: FirmwareUpdateDialogProps) {
  const { t } = useTranslation();

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [maskPhase, setMaskPhase] = useState<MaskPhase>(null);
  const [maskErrorMessage, setMaskErrorMessage] = useState<string>('');
  const pollingRef = useRef<PollingHandle | null>(null);
  const startPollTimerRef = useRef<number | null>(null);
  const releaseNetworkErrorSuppressRef = useRef<(() => void) | null>(null);

  const releaseNetworkErrorSuppress = useCallback(() => {
    releaseNetworkErrorSuppressRef.current?.();
    releaseNetworkErrorSuppressRef.current = null;
  }, []);

  const cleanupPolling = useCallback(() => {
    pollingRef.current?.stop();
    pollingRef.current = null;

    if (startPollTimerRef.current !== null) {
      window.clearTimeout(startPollTimerRef.current);
      startPollTimerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      cleanupPolling();
      releaseNetworkErrorSuppress();
    },
    [cleanupPolling, releaseNetworkErrorSuppress]
  );

  const startHealthPollingAfterDelay = useCallback(
    (delayMs: number) => {
      startPollTimerRef.current = window.setTimeout(() => {
        pollingRef.current = startPolling({
          fn: async () => {
            const response: any = await systemApi.otaStatus();
            const status = response?.data?.data ?? response?.data ?? response;
            if (status?.status === 'failed') {
              return { status, healthy: false };
            }
            if (status?.status !== 'success') {
              return { status, healthy: false };
            }
            await systemApi.healthCheck({ silent: true });
            return { status, healthy: true };
          },
          onSuccess: ({ status, healthy }) => {
            if (status?.status === 'failed') {
              cleanupPolling();
              releaseNetworkErrorSuppress();
              setMaskErrorMessage(
                status.error
                  || t('sys.device_info.ota_install_failed', '固件升级失败')
              );
              setMaskPhase('error');
              setUploading(false);
              return true;
            }
            if (!healthy) return false;
            cleanupPolling();
            releaseNetworkErrorSuppress();
            setMaskPhase(null);
            setUploading(false);
            toast.success(
              t('sys.device_info.ota_complete', '固件升级完成，设备已上线')
            );
            return true;
          },
          interval: 3000,
          timeout: 300000,
          onTimeout: () => {
            cleanupPolling();
            setMaskErrorMessage(
              t(
                'sys.device_info.ota_timeout_desc',
                '设备未能在预期时间内完成升级，请检查设备状态'
              )
            );
            setMaskPhase('timeout');
            setUploading(false);
          },
          onError: () => {
            // device still rebooting — keep polling
          },
        });

        startPollTimerRef.current = null;
      }, delayMs);
    },
    [cleanupPolling, releaseNetworkErrorSuppress, t]
  );

  const reset = useCallback(() => {
    setFile(null);
    setUploading(false);
    setConfirmed(false);
    setMaskErrorMessage('');
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const handleFileChange = (files: File[]) => {
    if (files.length === 0) {
      setFile(null);
      setConfirmed(false);
      return;
    }
    const selected = files[0];
    if (!selected.name.endsWith('.tar.gz')) {
      toast.error(
        t(
          'sys.device_info.invalid_firmware',
          '固件文件格式错误，请上传 .tar.gz 文件'
        )
      );
      return;
    }
    setFile(selected);
    setConfirmed(false);
  };

  const handleUpgrade = async () => {
    if (!file || !confirmed) return;

    // Ensure we don't have leftover polling/timer from previous runs
    cleanupPolling();
    releaseNetworkErrorSuppress();
    releaseNetworkErrorSuppressRef.current = enterNetworkErrorToastSuppress();

    setUploading(true);
    onOpenChange(false);

    // Phase 1: upload
    setMaskPhase('uploading');
    let firmwarePath = '';
    try {
      const parseResp: any = await systemApi.otaParse(file);
      firmwarePath = parseResp?.data?.firmware_path || '';
      if (!firmwarePath) {
        throw new Error('missing firmware_path');
      }
    } catch {
      releaseNetworkErrorSuppress();
      setMaskErrorMessage(
        t('sys.device_info.ota_upload_failed', '固件上传失败，请重试')
      );
      setMaskPhase('error');
      setUploading(false);
      return;
    }

    // Phase 2: trigger upgrade
    setMaskPhase('upgrading');
    try {
      await systemApi.otaInstallFromPath(firmwarePath);
    } catch {
      releaseNetworkErrorSuppress();
      setMaskErrorMessage(
        t('sys.device_info.ota_install_failed', '启动升级失败，请重试')
      );
      setMaskPhase('error');
      setUploading(false);
      return;
    }

    // Phase 3: wait for reboot then poll
    setMaskPhase('rebooting');
    startHealthPollingAfterDelay(30000);
  };

  const handleDismissError = () => {
    cleanupPolling();
    releaseNetworkErrorSuppress();
    setMaskPhase(null);
    setUploading(false);
    setMaskErrorMessage('');
  };

  const maskMessage = () => {
    switch (maskPhase) {
      case 'uploading':
        return t('sys.device_info.ota_uploading', '正在上传固件');
      case 'upgrading':
        return t('sys.device_info.ota_upgrading', '正在写入固件');
      case 'rebooting':
        return t('sys.device_info.ota_rebooting', '设备正在重启');
      case 'error':
        return t('sys.device_info.ota_failed', '固件更新失败');
      case 'timeout':
        return t('sys.device_info.ota_timeout_title', '升级超时');
      default:
        return '';
    }
  };

  const maskHint = () => {
    switch (maskPhase) {
      case 'uploading':
        return t(
          'sys.device_info.ota_uploading_hint',
          '请勿关闭页面或断开电源'
        );
      case 'upgrading':
        return t('sys.device_info.ota_upgrading_hint', '固件写入中，请勿断电');
      case 'rebooting':
        return t(
          'sys.device_info.ota_rebooting_hint',
          '请稍候，正在等待设备上线'
        );
      default:
        return undefined;
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md bg-card border-border shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              {t('sys.device_info.firmware_update', '固件升级')}
            </DialogTitle>
          </DialogHeader>

          <div className="py-2">
            <FileUpload
              single
              value={file ? [file] : []}
              onChange={handleFileChange}
              accept={{
                'application/gzip': ['.tar.gz'],
                'application/x-gzip': ['.tar.gz'],
              }}
              placeholder={t(
                'sys.device_info.upload_hint',
                '点击或拖拽文件上传'
              )}
              hint={t(
                'sys.device_info.upload_support',
                '支持 .tar.gz 固件包格式'
              )}
              disabled={uploading}
              showFileList
            />
          </div>

          {file && (
            <div className="flex items-start space-x-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <Label
                  htmlFor="firmware-confirm"
                  className="text-sm font-medium cursor-pointer leading-tight"
                >
                  {t(
                    'sys.device_info.firmware_confirm_text',
                    '固件升级期间设备将自动重启，请确保供电稳定，中断可能导致系统无法启动'
                  )}
                </Label>
                <div className="flex items-center space-x-2 pt-1">
                  <Checkbox
                    id="firmware-confirm"
                    checked={confirmed}
                    onCheckedChange={checked => setConfirmed(!!checked)}
                    disabled={uploading}
                  />
                  <Label
                    htmlFor="firmware-confirm"
                    className="text-xs text-muted-foreground cursor-pointer"
                  >
                    {t(
                      'sys.device_info.firmware_confirm_ack',
                      '确认并继续升级'
                    )}
                  </Label>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={uploading}
              className="border-border font-medium"
            >
              {t('common.cancel', '取消')}
            </Button>
            <Button
              onClick={handleUpgrade}
              disabled={!file || !confirmed || uploading}
              className="bg-foreground hover:bg-foreground/90 text-background font-medium"
            >
              {uploading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('sys.device_info.confirm_upgrade_btn', '确认升级')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SystemLoadingMask
        open={maskPhase !== null}
        message={maskMessage()}
        hint={maskHint()}
        error={maskPhase === 'error' || maskPhase === 'timeout'}
        errorMessage={
          maskErrorMessage
          || (maskPhase === 'timeout'
            ? t(
                'sys.device_info.ota_timeout_desc',
                '设备未能在预期时间内完成升级，请检查设备状态'
              )
            : t('sys.device_info.ota_failed', '固件更新失败'))
        }
        onClick={
          maskPhase === 'error' || maskPhase === 'timeout'
            ? handleDismissError
            : undefined
        }
      />
    </>
  );
}
