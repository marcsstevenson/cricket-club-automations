import * as v from 'valibot';

const Str = (max: number) => v.pipe(v.string(), v.maxLength(max));
const NumOrNull = v.nullable(v.number());

export const PlayerRefInSchema = v.variant('kind', [
  v.object({ kind: v.literal('squad'), key: Str(64), label: v.optional(v.string()) }),
  v.object({ kind: v.literal('other'), fullName: Str(120), label: v.optional(v.string()) }),
  v.object({ kind: v.literal('playhq'), playhqId: Str(64), label: v.optional(v.string()) }),
  v.object({
    kind: v.literal('named'),
    id: Str(64),
    playhqId: v.optional(v.string()),
    label: v.optional(v.string()),
  }),
]);

const ScoreSchema = v.object({ runs: NumOrNull, wkts: NumOrNull });

export const MilestoneCheckSchema = v.object({ actual: v.number(), share: v.number(), checked: v.boolean() });

export const MilestoneRowSchema = v.object({
  rowId: Str(64),
  type: v.picklist(['bat', 'bowl', 'hattrick']),
  player: v.nullable(PlayerRefInSchema),
  value: NumOrNull,
  source: v.picklist(['playhq', 'entered']),
  playhqValue: NumOrNull,
  touched: v.boolean(),
  check: v.optional(v.nullable(MilestoneCheckSchema)),
});

export const FormStateSchema = v.object({
  scoring: v.nullable(v.picklist(['yes', 'no', 'yes_issues', 'not_played'])),
  issues: Str(2000),
  notPlayedReason: v.nullable(v.picklist(['rain', 'cancelled', 'forfeit', 'other'])),
  notPlayedOther: Str(200),
  team: ScoreSchema,
  opp: ScoreSchema,
  scoreSource: v.picklist(['playhq', 'entered']),
  potd: v.nullable(PlayerRefInSchema),
  mascot: v.nullable(PlayerRefInSchema),
  highlights: Str(5000),
  photoIds: v.pipe(v.array(Str(64)), v.maxLength(20)),
  milestones: v.pipe(v.array(MilestoneRowSchema), v.maxLength(60)),
  updatedBy: Str(80),
});

export const ReportInSchema = v.object({
  ...FormStateSchema.entries,
  baseVersion: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

export type FormState = v.InferOutput<typeof FormStateSchema>;
export type ReportIn = v.InferOutput<typeof ReportInSchema>;
export type PlayerChoice = v.InferOutput<typeof PlayerRefInSchema>;
export type PlayerRefOut = Exclude<PlayerChoice, { kind: 'other' }> & { label: string };
export type MilestoneRow = FormState['milestones'][number];
export type Score = FormState['team'];
export type Scoring = NonNullable<FormState['scoring']>;
export type NotPlayedReason = NonNullable<FormState['notPlayedReason']>;
export type MilestoneType = MilestoneRow['type'];
export type Source = MilestoneRow['source'];
export type FieldErrors = Record<string, string>;

export interface MilestoneCandidate {
  type: 'bat' | 'bowl';
  player: PlayerRefOut;
  value: number;
}

export type MilestoneCheck = v.InferOutput<typeof MilestoneCheckSchema>;

/** Functional spec §6.3.1: pairs grades limit milestones to a fair share; open grades have no limits. */
export type MilestoneRule = { kind: 'pairs'; batBalls: number; bowlOvers: number } | { kind: 'open' };

export interface PlayerFigures {
  player: PlayerRefOut;
  ballsFaced: number | null;
  overs: number | null;
}

export interface CheckContext {
  available: boolean;
  rule: MilestoneRule;
  figures: PlayerFigures[];
}

export interface PlayhqStartData {
  available: boolean;
  result: { team: { runs: number; wkts: number }; opp: { runs: number; wkts: number } } | null;
  candidates: MilestoneCandidate[];
}

export function emptyForm(): FormState {
  return {
    scoring: null,
    issues: '',
    notPlayedReason: null,
    notPlayedOther: '',
    team: { runs: null, wkts: null },
    opp: { runs: null, wkts: null },
    scoreSource: 'entered',
    potd: null,
    mascot: null,
    highlights: '',
    photoIds: [],
    milestones: [],
    updatedBy: '',
  };
}
