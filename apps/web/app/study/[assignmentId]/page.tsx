import { AssignmentWorkspaceClient } from '@/components/assignment-workspace-client';

type AssignmentWorkspacePageProps = {
  params: Promise<{ assignmentId: string }>;
};

export default async function AssignmentWorkspacePage({ params }: AssignmentWorkspacePageProps) {
  const { assignmentId } = await params;
  return <AssignmentWorkspaceClient assignmentId={assignmentId} />;
}
