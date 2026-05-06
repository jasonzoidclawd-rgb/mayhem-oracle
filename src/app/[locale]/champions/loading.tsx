import { PageHeaderSkeleton, CardGridSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="py-8">
      <PageHeaderSkeleton />
      <CardGridSkeleton count={16} />
    </div>
  );
}
