import { CardSkeleton, TableSkeleton } from '@/components/ui/states';
import { Card } from '@/components/ui/card';

export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <div className="skeleton h-7 w-56" />
        <div className="skeleton h-4 w-80" />
      </div>
      <CardSkeleton count={4} />
      <Card>
        <TableSkeleton rows={8} />
      </Card>
    </div>
  );
}
