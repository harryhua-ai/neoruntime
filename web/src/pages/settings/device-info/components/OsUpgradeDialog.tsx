import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import { useTranslation } from 'react-i18next';
import { HardDriveUpload, Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import FileUpload from '@/components/file-upload';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import SystemLoadingMask from '@/components/system-loading-mask';
import {
  systemApi,
  type OSUpgradeStatus,
} from '@/services/api/system';
import { enterNetworkErrorToastSuppress } from '@/services/request';
import { startPolling, type PollingHandle } from '@/utils/polling';

export interface OsUpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type MaskPhase =
  | 'installing'
  | 'rebooting'
  | 'error'
  | 'timeout'
  | null;

// Job states the install poll treats as a hard failure.
const installFailureStates = ['failed', 'cancelled', 'rollback'];

export function OsUpgradeDialog({
  open,
  onOpenChange,
}: OsUpgradeDialogProps) {
  const { t } = useTranslation();

  // Backend job state — driven by upload/validate responses and the open
  // refresh, so the echoed package survives close/reopen.
  const [jobId, setJobId] = useState('');
  const [status, setStatus] = useState<OSUpgradeStatus>({ status: 'idle' });
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  // True only while the on-select upload+validate is in flight. The mask has
  // its own phase and runs with the dialog closed.
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const [maskPhase, setMaskPhase] = useState<MaskPhase>(null);
  const [maskErrorMessage, setMaskErrorMessage] = useState('');
  const pollingRef = useRef<PollingHandle | null>(null);
  // Guards against re-triggering the reboot call across polls while the
  // status lingers on awaiting_reboot before the device actually drops.
  const rebootTriggeredRef = useRef(false);
  const releaseNetworkErrorSuppressRef = useRef<(() => void) | null>(null);

  const releaseNetworkErrorSuppress = useCallback(() => {
    releaseNetworkErrorSuppressRef.current?.();
    releaseNetworkErrorSuppressRef.current = null;
  }, []);

  const cleanupPolling = useCallback(() => {
    pollingRef.current?.stop();
    pollingRef.current = null;
  }, []);

  useEffect(
    () => () => {
      cleanupPolling();
      releaseNetworkErrorSuppress();
    },
    [cleanupPolling, releaseNetworkErrorSuppress]
  );

  // Always query the active job — used both on open (to echo any staged
  // package) and after a failed upload/validate (to sync the backend state).
  const refresh = useCallback(async (silent = true) => {
    try {
      const resp: any = await systemApi.osUpgradeStatus(undefined, silent);
      const st: OSUpgradeStatus | undefined = resp?.data;
      if (st) {
        setStatus(st);
        setJobId(st.job_id || '');
      }
    } catch {
      // Device unreachable / no active job — leave the current status.
    }
  }, []);

  useEffect(() => {
    if (open) {
      setConfirmed(false);
      setBusy(false);
      rebootTriggeredRef.current = false;
      refresh(true);
    }
  }, [open, refresh]);

  // Cancel (if non-terminal) then delete the staged package. Cancel on a
  // terminal 'success' job is rejected by the backend and swallowed; delete
  // still succeeds because the job is terminal. Best-effort throughout.
  const teardownPackage = useCallback(async (id: string) => {
    if (!id) return;
    try {
      await systemApi.osUpgradeCancel(id);
    } catch {
      // Already terminal (success) or not cancellable — DELETE below still works.
    }
    try {
      await systemApi.osUpgradeDeletePackage(id);
    } catch {
      // Best-effort cleanup; the package may have been removed already.
    }
  }, []);

  const removePackage = useCallback(async () => {
    const id = jobId;
    setFile(null);
    setJobId('');
    setConfirmed(false);
    setStatus({ status: 'idle' });
    await teardownPackage(id);
  }, [jobId, teardownPackage]);

  const uploadAndValidate = useCallback(
    async (target: File, prevId?: string) => {
      setBusy(true);
      setStatus({ status: 'uploading' });
      setUploadProgress(0);
      // Free the backend slot from a previous package before uploading a new
      // one — the backend rejects a second upload while a job is active.
      if (prevId) {
        setJobId('');
        await teardownPackage(prevId);
      }
      let id = '';
      try {
        const uploadResp: any = await systemApi.osUpgradeUpload(
          target,
          setUploadProgress
        );
        const uploaded: OSUpgradeStatus | undefined = uploadResp?.data;
        id = uploaded?.job_id || '';
        if (!uploaded || !id) throw new Error('missing job_id');
        setJobId(id);
        setStatus(uploaded);
        const validateResp: any = await systemApi.osUpgradeValidate(id);
        const validated: OSUpgradeStatus | undefined = validateResp?.data;
        if (!validated) throw new Error('validate failed');
        setStatus(validated);
      } catch {
        if (id) {
          // The backend failed the job — sync its recorded error/message.
          await refresh(true);
        } else {
          setStatus({
            status: 'failed',
            error: t(
              'sys.device_info.os_upgrade_upload_failed',
              '升级包上传失败，请重试'
            ),
          });
        }
      } finally {
        setBusy(false);
      }
    },
    [refresh, t, teardownPackage]
  );

  const handleFileChange = (files: File[]) => {
    if (files.length === 0) {
      // X clicked — tear down the backend package so the slot is free.
      removePackage();
      return;
    }
    const selected = files[0];
    if (!selected.name.toLowerCase().endsWith('.swu')) {
      toast.error(t('sys.device_info.invalid_os_package', '请选择 .swu 文件'));
      return;
    }
    setFile(selected);
    setConfirmed(false);
    uploadAndValidate(selected, jobId);
  };

  // 取消 (footer) keeps the backend package so it can be echoed on reopen;
  // only the local selection is cleared. X on the file is the delete path.
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setFile(null);
      setConfirmed(false);
      setUploadProgress(0);
    }
    onOpenChange(nextOpen);
  };

  // Poll install status until awaiting_reboot, dispatch reboot once, then
  // probe the health endpoint until the device comes back online.
  const startInstallRebootPolling = useCallback(
    (id: string) => {
      pollingRef.current = startPolling({
        fn: async () => {
          if (!rebootTriggeredRef.current) {
            const resp: any = await systemApi.osUpgradeStatus(id, true);
            return {
              phase: 'install' as const,
              st: resp?.data as OSUpgradeStatus | undefined,
            };
          }
          try {
            await systemApi.healthCheck({ silent: true });
            return { phase: 'health' as const, healthy: true };
          } catch {
            return { phase: 'health' as const, healthy: false };
          }
        },
        onSuccess: ({ phase, st, healthy }) => {
          if (phase === 'install') {
            if (st && installFailureStates.includes(st.status)) {
              cleanupPolling();
              releaseNetworkErrorSuppress();
              setMaskErrorMessage(
                st.error
                  || t('sys.device_info.os_upgrade_failed', '系统升级失败')
              );
              setMaskPhase('error');
              return true;
            }
            if (
              st?.status === 'awaiting_reboot'
              && !rebootTriggeredRef.current
            ) {
              rebootTriggeredRef.current = true;
              setMaskPhase('rebooting');
              // Fire-and-forget: the device reboots regardless; the health
              // poll below catches it coming back online.
              systemApi.osUpgradeReboot(id).catch(() => {});
            }
            return false;
          }
          if (!healthy) return false;
          cleanupPolling();
          releaseNetworkErrorSuppress();
          setMaskPhase(null);
          toast.success(
            t(
              'sys.device_info.os_upgrade_complete',
              '系统升级完成，设备已上线'
            )
          );
          return true;
        },
        interval: 3000,
        timeout: 600000,
        onTimeout: () => {
          cleanupPolling();
          releaseNetworkErrorSuppress();
          setMaskErrorMessage(
            t(
              'sys.device_info.os_upgrade_timeout_desc',
              '设备未能在预期时间内完成升级，请检查设备状态'
            )
          );
          setMaskPhase('timeout');
        },
        onError: () => {
          // Device still rebooting / briefly unreachable — keep polling.
        },
      });
    },
    [cleanupPolling, releaseNetworkErrorSuppress, t]
  );

  const handleUpgrade = async () => {
    if (!jobId || !confirmed || status.status !== 'ready') return;

    cleanupPolling();
    releaseNetworkErrorSuppress();
    releaseNetworkErrorSuppressRef.current = enterNetworkErrorToastSuppress();
    rebootTriggeredRef.current = false;

    // Upload + validate already happened on file select; the mask only
    // covers install -> reboot.
    setMaskPhase('installing');
    onOpenChange(false);

    try {
      await systemApi.osUpgradeInstall(jobId);
    } catch {
      releaseNetworkErrorSuppress();
      setMaskErrorMessage(
        t('sys.device_info.os_upgrade_install_failed', '启动升级失败，请重试')
      );
      setMaskPhase('error');
      return;
    }
    startInstallRebootPolling(jobId);
  };

  const handleDismissError = () => {
    cleanupPolling();
    releaseNetworkErrorSuppress();
    setMaskPhase(null);
    setMaskErrorMessage('');
  };

  // Echo a previously uploaded package (e.g. after close/reopen) so the file
  // is visible and its X button can delete it from the backend.
  const echoFile = useMemo(
    () => (status.file_name
        ? ({
            name: status.file_name,
            size: status.file_size ?? 0,
          } as unknown as File)
        : null),
    [status.file_name, status.file_size]
  );
  const displayFile = file ?? echoFile;
  const ready = status.status === 'ready' && !!jobId;

  const maskMessage = () => {
    switch (maskPhase) {
      case 'installing':
        return t('sys.device_info.os_upgrade_installing', '正在写入系统');
      case 'rebooting':
        return t('sys.device_info.os_upgrade_rebooting', '设备正在重启');
      case 'error':
        return t('sys.device_info.os_upgrade_failed', '系统升级失败');
      case 'timeout':
        return t('sys.device_info.os_upgrade_timeout_title', '升级超时');
      default:
        return '';
    }
  };

  const maskHint = () => {
    switch (maskPhase) {
      case 'installing':
        return t(
          'sys.device_info.os_upgrade_installing_hint',
          '系统写入中，请勿断电'
        );
      case 'rebooting':
        return t(
          'sys.device_info.os_upgrade_rebooting_hint',
          '请稍候，正在等待设备上线'
        );
      default:
        return undefined;
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="max-w-md max-h-[85vh] flex flex-col gap-0 bg-card border-border shadow-xl p-0"
          // 升级流程敏感，禁止点击遮罩/四周关闭，避免误触中断
          onInteractOutside={e => e.preventDefault()}
          onPointerDownOutside={e => e.preventDefault()}
        >
          <DialogHeader className="p-6 pb-4">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <HardDriveUpload className="h-5 w-5" />
              {t('sys.device_info.os_upgrade_title', '系统 OS 升级')}
            </DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto px-6 pb-2 flex-1 min-h-0 space-y-4">
            <FileUpload
              single
              value={displayFile ? [displayFile] : []}
              onChange={handleFileChange}
              accept={{ 'application/octet-stream': ['.swu'] }}
              placeholder={t(
                'sys.device_info.os_upgrade_upload_hint',
                '点击或拖拽选择 SWUpdate 镜像'
              )}
              hint={t(
                'sys.device_info.os_upgrade_upload_support',
                '仅支持适用于 hailo15-ne503 的 .swu 包'
              )}
              disabled={busy}
              showFileList
            />

            {status.status === 'uploading' && (
              <div className="space-y-1.5">
                <Progress value={uploadProgress} />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {t('sys.device_info.os_upgrade_uploading', '正在上传')}
                  </span>
                  <span>{uploadProgress}%</span>
                </div>
              </div>
            )}

            {status.status === 'validating' && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>
                  {t(
                    'sys.device_info.os_upgrade_validating',
                    '正在校验升级包'
                  )}
                </span>
              </div>
            )}

            {status.error && (
              <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <ShieldAlert className="h-5 w-5 shrink-0" />
                <span>{status.error}</span>
              </div>
            )}

            {displayFile && ready && (
              <div className="flex items-start space-x-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <Label
                    htmlFor="os-upgrade-confirm"
                    className="text-sm font-medium cursor-pointer leading-tight"
                  >
                    {t(
                      'sys.device_info.os_upgrade_confirm_text',
                      '系统升级期间设备将自动重启，请确保供电稳定，中断可能导致系统无法启动'
                    )}
                  </Label>
                  <div className="flex items-center space-x-2 pt-1">
                    <Checkbox
                      id="os-upgrade-confirm"
                      checked={confirmed}
                      onCheckedChange={checked => setConfirmed(!!checked)}
                      disabled={busy}
                    />
                    <Label
                      htmlFor="os-upgrade-confirm"
                      className="text-xs text-muted-foreground cursor-pointer"
                    >
                      {t(
                        'sys.device_info.os_upgrade_confirm_ack',
                        '确认并继续升级'
                      )}
                    </Label>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="p-6 pt-4 mt-0">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={busy}
              className="border-border font-medium"
            >
              {t('common.cancel', '取消')}
            </Button>
            <Button
              onClick={handleUpgrade}
              disabled={!ready || !confirmed || busy}
              className="bg-foreground hover:bg-foreground/90 text-background font-medium"
            >
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('sys.device_info.os_upgrade_confirm_update', '确认更新')}
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
                'sys.device_info.os_upgrade_timeout_desc',
                '设备未能在预期时间内完成升级，请检查设备状态'
              )
            : t('sys.device_info.os_upgrade_failed', '系统升级失败'))
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
