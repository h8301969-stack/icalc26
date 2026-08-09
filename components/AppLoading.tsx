import React from 'react';

export type AppLoadingSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<AppLoadingSize, string> = {
  sm: 'app-loading-spinner--sm',
  md: 'app-loading-spinner--md',
  lg: 'app-loading-spinner--lg',
};

/**
 * Unified app loading spinner (blue/white fluid orbit).
 * Use for every busy/loading state instead of ad-hoc spinners.
 */
export const AppLoadingSpinner: React.FC<{
  size?: AppLoadingSize;
  className?: string;
  /** Accessible label when no visible text */
  label?: string;
}> = ({ size = 'md', className = '', label = 'Loading' }) => (
  <span
    className={`app-loading-spinner ${SIZE_CLASS[size]} ${className}`.trim()}
    role="status"
    aria-label={label}
  >
    <span className="app-loading-spinner__ring" aria-hidden="true" />
    <span className="app-loading-spinner__core" aria-hidden="true" />
  </span>
);

/** Compact inline row: spinner + optional label */
export const AppLoadingInline: React.FC<{
  label?: string;
  size?: AppLoadingSize;
  className?: string;
  isLight?: boolean;
}> = ({ label = 'Loading', size = 'sm', className = '', isLight = false }) => (
  <span
    className={`app-loading-inline inline-flex items-center gap-2 ${className}`.trim()}
    role="status"
    aria-live="polite"
  >
    <AppLoadingSpinner size={size} label={label} />
    {label ? (
      <span
        className={`app-subtext text-[10px] font-black uppercase tracking-[0.18em] ${
          isLight ? 'text-black/50' : 'text-white/50'
        }`}
      >
        {label}
      </span>
    ) : null}
  </span>
);

/**
 * Full-screen / panel loading card (auth, heavy ops).
 * Progress bar optional via progressMs (0.3s–1s window).
 */
export const AppLoadingCard: React.FC<{
  label: string;
  subtext?: string;
  isLight?: boolean;
  /** Timed bar fill duration in ms (clamped 300–1000). Omit for indeterminate shimmer. */
  progressMs?: number;
  className?: string;
}> = ({ label, subtext, isLight = false, progressMs, className = '' }) => {
  const timed =
    typeof progressMs === 'number' && Number.isFinite(progressMs)
      ? Math.min(1000, Math.max(300, progressMs))
      : null;

  return (
    <div
      className={`app-loading-card relative w-full max-w-xs rounded-[28px] border px-8 py-10 flex flex-col items-center gap-6 fluid-pop-in ${
        isLight
          ? 'bg-white/85 border-black/10 text-black'
          : 'pos-dashboard-card-glass border-white/12 text-white'
      } ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="relative flex items-center justify-center w-[88px] h-[88px]">
        <span className="app-loading-orb" aria-hidden="true">
          <span className="app-loading-orb__ring app-loading-orb__ring--outer" />
          <span className="app-loading-orb__ring app-loading-orb__ring--inner" />
          <span className="app-loading-orb__core" />
        </span>
      </div>

      <div className="text-center space-y-2">
        <p className={`app-loading-status text-sm font-black tracking-tight ${isLight ? 'text-black' : 'text-white'}`}>
          {label}
        </p>
        {subtext ? (
          <p className={`app-subtext text-[10px] font-bold ${isLight ? 'text-black/45' : 'text-white/45'}`}>
            {subtext}
          </p>
        ) : null}
      </div>

      <div className="w-full app-loading-bar" aria-hidden="true">
        <div
          className={`app-loading-bar__fill ${timed != null ? 'app-loading-bar__fill--timed' : 'app-loading-bar__fill--indeterminate'}`}
          style={timed != null ? { animationDuration: `${timed}ms` } : undefined}
        />
      </div>
    </div>
  );
};

export default AppLoadingSpinner;
