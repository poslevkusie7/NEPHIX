import { StudyClient } from '@/components/study-client';

type StudyPageProps = {
  searchParams: Promise<{ assignmentId?: string | string[]; unitId?: string | string[] }>;
};

export default async function StudyPage({ searchParams }: StudyPageProps) {
  const params = await searchParams;
  const assignmentId = Array.isArray(params.assignmentId) ? params.assignmentId[0] : params.assignmentId;
  const unitId = Array.isArray(params.unitId) ? params.unitId[0] : params.unitId;

  return <StudyClient initialAssignmentId={assignmentId ?? null} initialUnitId={unitId ?? null} />;
}
