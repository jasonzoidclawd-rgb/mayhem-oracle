import { PageHeaderSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="py-8">
      <PageHeaderSkeleton />
      <TableSkeleton rows={8} />
    </div>
  );
}
