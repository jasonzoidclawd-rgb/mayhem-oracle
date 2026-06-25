export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-[var(--color-bg-card)] ${className}`}
    />
  );
}

export function PageHeaderSkeleton() {
  return (
    <header className="mb-8 space-y-2">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
    </header>
  );
}

export function CardGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-32" />
      ))}
    </div>
  );
}

// Mirrors the /champions dashboard: control bar (view switcher + search),
// class-filter chips, a tier heading, and the responsive card grid — so the
// layout doesn't shift when ChampionsIndex hydrates.
export function ChampionsDashboardSkeleton({ count = 18 }: { count?: number }) {
  return (
    <div>
      <div className="space-y-3 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-12 sm:h-9 w-48 rounded-xl" />
          <Skeleton className="h-12 sm:h-9 flex-1 min-w-[140px] sm:max-w-xs rounded-lg" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 sm:h-7 w-20 rounded" />
          ))}
        </div>
      </div>
      <Skeleton className="h-6 w-24 mb-3 rounded-md" />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-3">
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton key={i} className="h-44 rounded-[14px]" />
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
