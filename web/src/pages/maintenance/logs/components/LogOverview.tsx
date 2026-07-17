import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { AlertCircle, AlertTriangle, Activity, Server } from 'lucide-react';
import { cn } from '@/lib/utils';
import { logsApi } from '@/services/api/logs';

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
  bgColor: string;
}

function StatCard({ icon: Icon, label, value, color, bgColor }: StatCardProps) {
  return (
    <Card className={cn('p-4 border-l-4', bgColor, `border-l-${color}`)}>
      <div className="flex items-center gap-3">
        <div className={cn('p-2 rounded-lg', bgColor)}>
          <Icon
            className={cn('w-5 h-5', {
              'text-red-600 dark:text-red-400': color === 'red',
              'text-amber-600 dark:text-amber-400': color === 'amber',
              'text-blue-600 dark:text-blue-400': color === 'blue',
              'text-gray-600 dark:text-gray-400': color === 'gray',
            })}
          />
        </div>
        <div className="flex-1">
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="text-2xl font-semibold text-foreground">{value}</div>
        </div>
      </div>
    </Card>
  );
}

interface LogOverviewProps {
  lines?: number;
}

export default function LogOverview({ lines = 1000 }: LogOverviewProps) {
  const { t } = useTranslation();

  const { data: statsData, isLoading } = useQuery({
    queryKey: ['logStatistics', lines],
    queryFn: async () => {
      const response = await logsApi.getStatistics(lines);
      return response;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="p-4 h-24 animate-pulse bg-muted/30" />
        ))}
      </div>
    );
  }

  const stats = statsData?.statistics || {
    today_errors: 0,
    today_warnings: 0,
    operations: 0,
    security_events: 0,
    alarm_events: 0,
    system_events: 0,
    total_entries: 0,
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <StatCard
        icon={AlertCircle}
        label={t('sys.logs.overview.today_errors', '今日错误')}
        value={stats.today_errors}
        color="red"
        bgColor="bg-red-50 dark:bg-red-950/20"
      />
      <StatCard
        icon={AlertTriangle}
        label={t('sys.logs.overview.today_warnings', '警告数量')}
        value={stats.today_warnings}
        color="amber"
        bgColor="bg-amber-50 dark:bg-amber-950/20"
      />
      <StatCard
        icon={Activity}
        label={t('sys.logs.overview.operations', '操作记录')}
        value={stats.operations}
        color="blue"
        bgColor="bg-blue-50 dark:bg-blue-950/20"
      />
      <StatCard
        icon={Server}
        label={t('sys.logs.overview.system_events', '系统事件')}
        value={stats.system_events}
        color="gray"
        bgColor="bg-gray-50 dark:bg-gray-950/20"
      />
    </div>
  );
}
