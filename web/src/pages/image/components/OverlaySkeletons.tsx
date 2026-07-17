import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Skeleton for the OSD settings sidebar (text / datetime / image overlays).
 * Mirrors the section/card layout of `OsdSettings` so the loading state reads
 * as "this region is loading its config" rather than a bare spinner.
 */
export function OsdSettingsSkeleton() {
  return (
    <div className="space-y-4">
      {/* Stream selector */}
      <Card className="bg-background shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-3.5 w-3.5 rounded-sm" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="flex gap-2">
            {[0, 1, 2].map(i => (
              <Skeleton key={i} className="h-12 flex-1 rounded-md" />
            ))}
          </div>
          <Skeleton className="h-3 w-full" />
        </CardContent>
      </Card>

      {/* Text overlay */}
      <Card className="bg-background shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-3.5 w-3.5 rounded-sm" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-7 w-12 rounded-md" />
          </div>
          <div className="space-y-2 rounded-md bg-muted/50 p-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 flex-1" />
              <Skeleton className="h-7 w-7 rounded-md" />
              <Skeleton className="h-7 w-7 rounded-md" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-7 w-16 rounded-md" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* DateTime overlay */}
      <Card className="bg-background shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-3.5 w-3.5 rounded-sm" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-6 w-10 rounded-full" />
          </div>
        </CardContent>
      </Card>

      {/* Image overlay */}
      <Card className="bg-background shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-3.5 w-3.5 rounded-sm" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-7 w-12 rounded-md" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Skeleton for the privacy-mask sidebar (master toggle + style, DPM, regions).
 * Mirrors the card layout of `PrivacyMaskSettings`.
 */
export function PrivacyMaskSkeleton() {
  return (
    <div className="space-y-4">
      {/* Master toggle */}
      <Card className="bg-background shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-3.5 w-3.5 rounded-sm" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-6 w-10 rounded-full" />
          </div>
          <Skeleton className="h-3 w-full" />
        </CardContent>
      </Card>

      {/* Dynamic privacy mask (DPM) */}
      <Card className="bg-background shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-3.5 w-3.5 rounded-sm" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-6 w-10 rounded-full" />
          </div>
          <Skeleton className="h-3 w-full" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        </CardContent>
      </Card>

      {/* Regions */}
      <Card className="bg-background shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-3.5 w-3.5 rounded-sm" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-7 w-20 rounded-md" />
          </div>
          <Skeleton className="h-3 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
