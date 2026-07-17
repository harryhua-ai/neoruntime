import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';

export default function MediaSettingsSkeleton() {
  return (
    <div className="p-4 space-y-8">
      {/* 1. 码流选择 */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="w-4 h-4 rounded-sm" />
          <Skeleton className="h-4 w-20" />
        </div>

        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <button
              key={i}
              type="button"
              disabled
              className="w-full rounded-2xl border border-border p-4 text-left"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-4 w-28" />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Skeleton className="h-2 w-2 rounded-full" />
                  <Skeleton className="h-3 w-14" />
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* 2. 码流配置 */}
      <section className="space-y-4">
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-6 space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Skeleton className="w-4 h-4 rounded-sm" />
                <Skeleton className="h-4 w-20" />
              </div>
              <Skeleton className="h-9 w-32 rounded-xl" />
            </div>

            <Skeleton className="h-px w-full" />

            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-6 w-10 rounded-full" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-10 w-full rounded-xl" />
                </div>
              ))}

              <div className="space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-10 w-full md:max-w-[220px] rounded-xl" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Skeleton className="h-10 w-28 rounded-md" />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* 3. RTSP 服务 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="w-4 h-4 rounded-sm" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-6 w-10 rounded-full" />
        </div>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5 space-y-3">
            <Skeleton className="h-3 w-48" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-40" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-10 flex-1 rounded-xl" />
                <Skeleton className="h-10 w-10 rounded-md" />
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
