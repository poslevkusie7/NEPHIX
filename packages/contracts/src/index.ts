import { z } from 'zod';

export const taskTypeSchema = z.enum(['reading', 'essay']);
export type TaskType = z.infer<typeof taskTypeSchema>;

export const unitTypeSchema = z.enum(['reading', 'thesis', 'outline', 'writing', 'revise']);
export type UnitType = z.infer<typeof unitTypeSchema>;

export const unitStatusSchema = z.enum(['unread', 'active', 'completed']);
export type UnitStatus = z.infer<typeof unitStatusSchema>;

export const assignmentStatusSchema = z.enum(['not_started', 'in_progress', 'completed']);
export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>;

export const outlineSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  guidingQuestion: z.string().default(''),
  targetWords: z.number().int().nonnegative(),
});
export type OutlineSection = z.infer<typeof outlineSectionSchema>;

export const readingUnitPayloadSchema = z.object({
  text: z.string().min(1),
  fragmentLabel: z.string().optional(),
});

export const thesisUnitPayloadSchema = z.object({
  topic: z.string().min(1),
  essayType: z.enum(['opinion', 'analytical', 'comparative', 'interpretive']),
  wordCount: z.number().int().positive(),
  deadlineISO: z.string().datetime().optional(),
});

export const outlineUnitPayloadSchema = z.object({
  sections: z.array(outlineSectionSchema).min(1),
});

export const writingUnitPayloadSchema = z.object({
  sectionId: z.string().min(1),
  sectionTitle: z.string().min(1),
  guidingQuestion: z.string().default(''),
  targetWords: z.number().int().positive(),
});

export const reviseUnitPayloadSchema = z.object({
  focuses: z.array(z.string()).default(['clarity', 'structure', 'word_balance']),
  targetWordCount: z.number().int().positive(),
});

export const unitPayloadSchema = z.union([
  readingUnitPayloadSchema,
  thesisUnitPayloadSchema,
  outlineUnitPayloadSchema,
  writingUnitPayloadSchema,
  reviseUnitPayloadSchema,
]);
export type UnitPayload = z.infer<typeof unitPayloadSchema>;

export const revisionIssueSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']),
  message: z.string().min(1),
  sectionTitle: z.string().optional(),
});
export type RevisionIssue = z.infer<typeof revisionIssueSchema>;

export const assignmentUnitSchema = z.object({
  id: z.string().min(1),
  assignmentId: z.string().min(1),
  orderIndex: z.number().int().nonnegative(),
  unitType: unitTypeSchema,
  title: z.string().min(1),
  payload: z.record(z.any()),
  targetWords: z.number().int().positive().nullable().optional(),
});
export type AssignmentUnitDTO = z.infer<typeof assignmentUnitSchema>;

export const assignmentSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  subject: z.string().min(1),
  taskType: taskTypeSchema,
  deadlineISO: z.string().datetime(),
  status: assignmentStatusSchema,
  currentUnitId: z.string().nullable(),
  totalUnits: z.number().int().nonnegative(),
  completedUnits: z.number().int().nonnegative(),
});
export type AssignmentSummaryDTO = z.infer<typeof assignmentSummarySchema>;

export const assignmentDetailSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  subject: z.string().min(1),
  taskType: taskTypeSchema,
  deadlineISO: z.string().datetime(),
  units: z.array(assignmentUnitSchema),
});
export type AssignmentDetailDTO = z.infer<typeof assignmentDetailSchema>;

export const userUnitStateSchema = z.object({
  unitId: z.string().min(1),
  status: unitStatusSchema,
  bookmarked: z.boolean().default(false),
  content: z.record(z.any()).nullable().optional(),
  position: z.record(z.any()).nullable().optional(),
  updatedAtISO: z.string().datetime(),
});
export type UserUnitStateDTO = z.infer<typeof userUnitStateSchema>;

export const assignmentStateSchema = z.object({
  assignmentId: z.string().min(1),
  status: assignmentStatusSchema,
  currentUnitId: z.string().nullable(),
  unitStates: z.array(userUnitStateSchema),
});
export type AssignmentStateDTO = z.infer<typeof assignmentStateSchema>;

export const signupRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;

export const loginRequestSchema = signupRequestSchema;
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const forgotPasswordRequestSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(8).max(128),
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const authUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  createdAtISO: z.string().datetime(),
});
export type AuthUserDTO = z.infer<typeof authUserSchema>;

export const patchUnitStateRequestSchema = z.object({
  content: z.record(z.any()).optional(),
  position: z.record(z.any()).optional(),
  status: unitStatusSchema.optional(),
});
export type PatchUnitStateRequest = z.infer<typeof patchUnitStateRequestSchema>;

export const bookmarkUnitRequestSchema = z.object({
  bookmarked: z.boolean(),
});
export type BookmarkUnitRequest = z.infer<typeof bookmarkUnitRequestSchema>;

export const completeUnitResponseSchema = z.object({
  completedUnitId: z.string(),
  nextUnitId: z.string().nullable(),
  assignmentStatus: assignmentStatusSchema,
});
export type CompleteUnitResponse = z.infer<typeof completeUnitResponseSchema>;
