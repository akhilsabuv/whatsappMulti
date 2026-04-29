import { notFound } from 'next/navigation';
import { DashboardClient } from '../../../components/dashboard-client';
import { DASHBOARD_VIEWS, type DashboardView } from '../../../lib/dashboard-views';

export default async function DashboardSectionPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;

  if (!DASHBOARD_VIEWS.includes(view as DashboardView)) {
    notFound();
  }

  return <DashboardClient initialView={view as DashboardView} />;
}
