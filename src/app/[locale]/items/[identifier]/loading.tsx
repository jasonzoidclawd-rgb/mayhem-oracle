export default function ItemDetailLoading() {
  return (
    <div className="py-8 max-w-3xl animate-pulse" aria-label="Loading item">
      <div className="h-5 w-28 rounded bg-[var(--color-bg-elevated)] mb-8" />
      <div className="flex items-center gap-5 mb-8">
        <div className="h-20 w-20 rounded-xl bg-[var(--color-bg-elevated)]" />
        <div className="space-y-3 flex-1">
          <div className="h-8 w-56 max-w-full rounded bg-[var(--color-bg-elevated)]" />
          <div className="h-5 w-24 rounded bg-[var(--color-bg-elevated)]" />
        </div>
      </div>
      <div className="h-32 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border-default)]" />
    </div>
  );
}
