import { z } from 'zod';

export const taskTypeSchema = z.enum(['reading', 'essay']);
export type TaskType = z.infer<typeof taskTypeSchema>;

export const unitTypeSchema = z.enum(['reading', 'thesis', 'outline', 'writing', 'revise']);
export type UnitType = z.infer<typeof unitTypeSchema>;

export const unitStatusSchema = z.enum(['unread', 'active', 'completed']);
export type UnitStatus = z.infer<typeof unitStatusSchema>;

export const effectiveUnitStatusSchema = z.enum(['unread', 'active', 'completed', 'bookmarked']);
export type EffectiveUnitStatus = z.infer<typeof effectiveUnitStatusSchema>;

export const assignmentStatusSchema = z.enum(['not_started', 'in_progress', 'completed']);
export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>;

export const gateStatusSchema = z.enum(['ready', 'warn']);
export type GateStatus = z.infer<typeof gateStatusSchema>;

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
  passId: z.string().min(1).optional(),
  actionStatus: z.enum(['open', 'postponed', 'ignored', 'resolved']).optional(),
});
export type RevisionIssue = z.infer<typeof revisionIssueSchema>;

export const revisionIssueActionStatusSchema = z.enum([
  'open',
  'postponed',
  'ignored',
  'resolved',
]);
export type RevisionIssueActionStatus = z.infer<typeof revisionIssueActionStatusSchema>;

export const revisionPassResultSchema = z.object({
  passId: z.string().min(1),
  passTitle: z.string().min(1),
  issues: z.array(revisionIssueSchema),
});
export type RevisionPassResult = z.infer<typeof revisionPassResultSchema>;

export const clarificationTurnSchema = z.object({
  id: z.string().min(1),
  unitId: z.string().min(1),
  userMessage: z.string().min(1),
  assistantMessage: z.string().min(1),
  createdAtISO: z.string().datetime(),
});
export type ClarificationTurn = z.infer<typeof clarificationTurnSchema>;

export const thesisSuggestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});
export type ThesisSuggestion = z.infer<typeof thesisSuggestionSchema>;

export const writingHintSchema = z.object({
  text: z.string().min(1),
});
export type WritingHint = z.infer<typeof writingHintSchema>;

export const scheduleGoalSchema = z.object({
  id: z.string().min(1),
  assignmentId: z.string().min(1),
  dateISO: z.string().datetime(),
  goalType: z.enum(['sources', 'thesis', 'outline', 'writing', 'revise']),
  unitId: z.string().nullable().optional(),
  targetWords: z.number().int().positive().nullable().optional(),
  status: z.enum(['pending', 'done', 'skipped']),
  title: z.string().min(1),
});
export type ScheduleGoal = z.infer<typeof scheduleGoalSchema>;

export const essayParseResultSchema = z.object({
  topic: z.string().min(1),
  essayType: z.enum(['opinion', 'analytical', 'comparative', 'interpretive']),
  wordCount: z.number().int().positive(),
  deadlineISO: z.string().datetime().nullable(),
  confidence: z.number().min(0).max(1),
});
export type EssayParseResult = z.infer<typeof essayParseResultSchema>;

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

export const bookmarkedReadingUnitSchema = z.object({
  unitId: z.string().min(1),
  assignmentId: z.string().min(1),
  assignmentTitle: z.string().min(1),
  assignmentSubject: z.string().min(1),
  unitTitle: z.string().min(1),
  preview: z.string().min(1),
  updatedAtISO: z.string().datetime(),
});
export type BookmarkedReadingUnitDTO = z.infer<typeof bookmarkedReadingUnitSchema>;

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
  effectiveStatus: effectiveUnitStatusSchema.default('unread'),
  bookmarked: z.boolean().default(false),
  readinessWarnings: z.array(z.string()).default([]),
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
  gateStatus: gateStatusSchema.default('ready'),
  warnings: z.array(z.string()).default([]),
});
export type CompleteUnitResponse = z.infer<typeof completeUnitResponseSchema>;

export const unitChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
});
export type UnitChatRequest = z.infer<typeof unitChatRequestSchema>;

export const thesisSuggestionsRequestSchema = z.object({
  regenerate: z.boolean().optional().default(false),
});
export type ThesisSuggestionsRequest = z.infer<typeof thesisSuggestionsRequestSchema>;

export const writingHintRequestSchema = z.object({
  currentSectionText: z.string().optional(),
});
export type WritingHintRequest = z.infer<typeof writingHintRequestSchema>;

export const essayParseRequestSchema = z.object({
  prompt: z.string().min(1),
  timezone: z.string().optional(),
});
export type EssayParseRequest = z.infer<typeof essayParseRequestSchema>;
