import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
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
import { systemApi } from '@/services/api/system';

export interface ResetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ResetDialog({ open, onOpenChange }: ResetDialogProps) {
  const { t } = useTranslation();
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleFactoryReset = async () => {
    if (!resetConfirmed) {
      toast.error(
        t('sys.device_info.factory_reset_confirm', '请确认恢复出厂设置的风险')
      );
      return;
    }

    setIsResetting(true);
    try {
      await systemApi.factoryReset();
      toast.success(
        t(
          'sys.device_info.factory_reset_success',
          '已触发恢复出厂设置，设备即将重启'
        )
      );
      onOpenChange(false);
      setTimeout(() => {
        window.location.href = '/login';
      }, 3000);
    } catch {
      toast.error(
        t('sys.device_info.factory_reset_failed', '恢复出厂设置失败')
      );
      setIsResetting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md bg-card border-border shadow-xl">
        <AlertDialogHeader>
          <div className="flex items-center gap-2 text-destructive mb-1">
            <AlertTriangle className="w-5 h-5" />
            <AlertDialogTitle className="text-lg font-bold">
              {t('sys.device_info.factory_reset_title', '恢复出厂设置')}
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-muted-foreground text-xs">
            {t(
              'sys.device_info.factory_reset_desc',
              '这将清空设备上的所有数据并恢复到初始状态。'
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-2 space-y-4">
          <div className="bg-red-50 border border-red-200 dark:bg-red-950/30 dark:border-red-900/50 p-4">
            <p className="text-xs font-bold text-red-600 dark:text-red-400 mb-2">
              {t(
                'sys.device_info.factory_reset_warning',
                '警告：此操作不可逆！'
              )}
            </p>
            <ul className="text-[12px] font-medium text-red-600/90 dark:text-red-300/90 space-y-1.5 ml-4 list-disc marker:text-red-400 dark:marker:text-red-500">
              <li>
                {t(
                  'sys.device_info.factory_reset_item1',
                  '所有用户配置信息将被删除'
                )}
              </li>
              <li>
                {t(
                  'sys.device_info.factory_reset_item2',
                  '网络设置将恢复为默认 DHCP'
                )}
              </li>
              <li>
                {t(
                  'sys.device_info.factory_reset_item3',
                  '系统日志和历史数据将被清空'
                )}
              </li>
              <li>
                {t(
                  'sys.device_info.factory_reset_item4',
                  '第三方应用和数据将被擦除'
                )}
              </li>
            </ul>
          </div>

          <div className="flex items-center space-x-2 pt-2">
            <Checkbox
              id="reset-confirm"
              checked={resetConfirmed}
              onCheckedChange={checked => setResetConfirmed(checked as boolean)}
              className="border-gray-900 dark:border-red-500 data-[state=checked]:bg-red-600 dark:data-[state=checked]:bg-red-500 data-[state=checked]:border-red-600 dark:data-[state=checked]:border-red-500 h-4 w-4"
            />
            <label
              htmlFor="reset-confirm"
              className="text-xs font-semibold text-foreground dark:text-red-100 cursor-pointer select-none"
            >
              {t(
                'sys.device_info.factory_reset_confirm',
                '我已了解风险并确认进行恢复出厂设置'
              )}
            </label>
          </div>
        </div>

        <AlertDialogFooter className="mt-2">
          <AlertDialogCancel
            disabled={isResetting}
            className="border-border font-medium"
          >
            {t('common.cancel', '取消')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleFactoryReset}
            disabled={isResetting || !resetConfirmed}
            className="bg-destructive hover:bg-destructive/90 text-white font-medium"
          >
            {isResetting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : null}
            {t('common.confirm', '确认重置')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
