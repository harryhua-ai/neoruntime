import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { ChevronDown, AlertCircle } from 'lucide-react';
import { logsApi } from '@/services/api/logs';
import LogCard from './LogCard';
import type { LogEntry, LogFilterOptions, LogType } from '@/types/log';

interface LogListProps {
  type: LogType;
  target: string | null;
  filters: LogFilterOptions;
  onEntryClick?: (entry: LogEntry) => void;
}

export default function LogList({
  type,
  target,
  filters,
  onEntryClick,
}: LogListProps) {
  const { t } = useTranslation();

  // Fetch log entries
  const {
    data: entriesData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['logEntries', type, target, filters],
    queryFn: async () => {
      if (!target) return null;
      const response = await logsApi.getStructuredEntries(type, target, {
        ...filters,
        limit: filters.limit || 100,
      });
      return response;
    },
    enabled: !!target,
    refetchInterval: 30000, // Refresh every 30 seconds
    retry: false,
  });

  const entries = useMemo(() => entriesData?.entries || [], [entriesData]);

  const totalCount = entriesData?.total || 0;
  const filteredCount = entriesData?.filtered || 0;

  if (!target) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>{t('sys.logs.please_select_source', '请选择日志源')}</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <div className="w-8 h-8 border-2 border-[#f24a00] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-destructive" />
          <p className="text-destructive mb-4">
            {t('sys.logs.fetch_error', '获取日志失败')}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            {t('common.retry', '重试')}
          </Button>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>{t('sys.logs.no_logs', '没有找到日志')}</p>
          {filteredCount > 0 && (
            <p className="text-sm mt-2">
              {t('sys.logs.filtered_out', '已过滤掉 {{count}} 条日志', {
                count: totalCount - filteredCount,
              })}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header with count */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {t(
            'sys.logs.showing_entries',
            '显示 {{filtered}} / {{total}} 条日志',
            {
              filtered: filteredCount,
              total: totalCount,
            }
          )}
        </span>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          {t('common.refresh')}
        </Button>
      </div>

      {/* Log entries */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {entries.map(entry => (
            <LogCard
              key={entry.id}
              entry={entry}
              onClick={() => onEntryClick?.(entry)}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Load more indicator */}
      {filteredCount < totalCount && (
        <div className="p-4 border-t border-border text-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // TODO: Implement load more functionality
            }}
          >
            {t('sys.logs.load_more', '加载更多')}
            <ChevronDown className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
