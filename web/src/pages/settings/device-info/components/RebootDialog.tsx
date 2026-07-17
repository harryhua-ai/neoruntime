import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import SystemLoadingMask from '@/components/system-loading-mask';
import { systemApi } from '@/services/api/system';
import { enterNetworkErrorToastSuppress } from '@/services/request';
import { startPolling, type PollingHandle } from '@/utils/polling';

export interface RebootDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RebootDialog({ open, onOpenChange }: RebootDialogProps) {
  const { t } = useTranslation();
  const [isRebooting, setIsRebooting] = useState(false);
  const [maskError, setMaskError] = useState(false);
  const pollingRef = useRef<PollingHandle | null>(null);
  const startPollTimerRef = useRef<number | null>(null);
  const releaseNetworkErrorSuppressRef = useRef<(() => void) | null>(null);

  const releaseNetworkErrorSuppress = () => {
    releaseNetworkErrorSuppressRef.current?.();
    releaseNetworkErrorSuppressRef.current = null;
  };

  useEffect(() => () => releaseNetworkErrorSuppress(), []);

  const handleReboot = async () => {
    releaseNetworkErrorSuppress();
    releaseNetworkErrorSuppressRef.current = enterNetworkErrorToastSuppress();

    setIsRebooting(true);
    setMaskError(false);
    onOpenChange(false);

    pollingRef.current?.stop();
    pollingRef.current = null;
    if (startPollTimerRef.current !== null) {
      window.clearTimeout(startPollTimerRef.current);
      startPollTimerRef.current = null;
    }

    try {
      await systemApi.restart();
    } catch {
      // restart() may throw because the device cuts the connection — that's expected
    }

    // Wait for device to go down before polling
    startPollTimerRef.current = window.setTimeout(() => {
      pollingRef.current = startPolling({
        fn: () => systemApi.healthCheck({ silent: true }),
        onSuccess: () => {
          releaseNetworkErrorSuppress();
          setIsRebooting(false);
          toast.success(t('sys.device_info.reboot_complete', '系统重启完成'));
          return true;
        },
        interval: 3000,
        timeout: 180000,
        onTimeout: () => {
          setMaskError(true);
        },
        onError: () => {
          // device still offline — keep polling
        },
      });
      startPollTimerRef.current = null;
    }, 30000);
  };

  const handleDismissError = () => {
    pollingRef.current?.stop();
    pollingRef.current = null;
    if (startPollTimerRef.current !== null) {
      window.clearTimeout(startPollTimerRef.current);
      startPollTimerRef.current = null;
    }
    releaseNetworkErrorSuppress();
    setIsRebooting(false);
    setMaskError(false);
  };

  return (
    <>
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent className="max-w-md bg-card border-border shadow-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-bold">
              {t('sys.device_info.reboot_title', '重启系统')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-xs">
              {t(
                'sys.device_info.reboot_desc',
                '您确定要重启设备吗？设备重启期间将无法访问系统服务。'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel className="border-border font-medium">
              {t('common.cancel', '取消')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReboot}
              disabled={isRebooting}
              className="bg-foreground hover:bg-foreground/90 text-background font-medium"
            >
              {isRebooting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              {t('common.confirm', '确认重启')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SystemLoadingMask
        open={isRebooting}
        message={
          maskError
            ? t('sys.device_info.reboot_timeout_title', '重启超时')
            : t('sys.device_info.rebooting', '系统正在重启')
        }
        hint={t('sys.device_info.rebooting_hint', '请稍候，正在等待设备上线')}
        error={maskError}
        errorMessage={t(
          'sys.device_info.reboot_timeout_desc',
          '设备未能在预期时间内重启，请检查设备状态'
        )}
        onClick={maskError ? handleDismissError : undefined}
      />
    </>
  );
}
