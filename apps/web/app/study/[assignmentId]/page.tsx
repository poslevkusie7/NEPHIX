import { redirect } from 'next/navigation';

type AssignmentWorkspacePageProps = {
  params: Promise<{ assignmentId: string }>;
  searchParams: Promise<{ unitId?: string | string[] }>;
};

export default async function AssignmentWorkspacePage({
  params,
  searchParams,
}: AssignmentWorkspacePageProps) {
  const { assignmentId } = await params;
  const { unitId } = await searchParams;
  const unitIdValue = Array.isArray(unitId) ? unitId[0] : unitId;
  const nextParams = new URLSearchParams({ assignmentId });

  if (unitIdValue) {
    nextParams.set('unitId', unitIdValue);
  }

  redirect(`/study?${nextParams.toString()}`);
}
