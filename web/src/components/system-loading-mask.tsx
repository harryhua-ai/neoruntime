import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import SvgIcon from '@/components/svg-icon';

export interface SystemLoadingMaskProps {
  open: boolean;
  /** Primary message shown to user */
  message: string;
  /** Secondary hint text */
  hint?: string;
  /** Show error state (timeout / failure) */
  error?: boolean;
  /** Error message override */
  errorMessage?: string;
  /** Click handler — useful for dismissing error state */
  onClick?: () => void;
  className?: string;
}

export default function SystemLoadingMask({
  open,
  message,
  hint,
  error = false,
  errorMessage,
  onClick,
  className,
}: SystemLoadingMaskProps) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm',
        className
      )}
    >
      <div
        className={cn(
          'flex flex-col items-center gap-4 rounded-2xl bg-card border border-border px-10 py-8 shadow-2xl max-w-xs w-full mx-4',
          error && onClick && 'cursor-pointer'
        )}
        onClick={error ? onClick : undefined}
      >
        {error ? (
          <AlertTriangle className="w-12 h-12 text-destructive" />
        ) : (
          <div className="relative flex items-center justify-center">
            <SvgIcon
              icon="ipc"
              className="w-12 h-12 text-muted-foreground animate-pulse"
            />
          </div>
        )}

        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-sm font-medium text-foreground flex items-center">
            {message}
            {!error && (
              <span className="inline-flex w-4 overflow-hidden ml-0.5">
                <span className="animate-[dotBounce_1.4s_ease-in-out_infinite]">
                  .
                </span>
                <span className="animate-[dotBounce_1.4s_ease-in-out_0.2s_infinite]">
                  .
                </span>
                <span className="animate-[dotBounce_1.4s_ease-in-out_0.4s_infinite]">
                  .
                </span>
              </span>
            )}
          </span>
          {(hint || errorMessage) && (
            <span className="text-xs text-muted-foreground">
              {error ? errorMessage : hint}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
