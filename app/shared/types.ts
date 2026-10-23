export type Role = 'tank' | 'healer' | 'dps' | 'unknown';
export type Mode = 'all' | 'wipes' | 'kills';
export type Category = 'mechanics' | 'survival' | 'output' | 'utility';
export type Player = { id: number; name: string; class: string; spec: string; role: Role };
export type Fight = {
  id: number;
  encounterId: number;
  name: string;
  difficulty: number;
  startTime: number;
  endTime: number;
  kill: boolean;
  percentage: number | null;
  friendlyPlayers: number[];
  playerSpecs?: Record<number, string>;
  inProgress?: boolean;
};
export type Report = {
  code: string;
  title: string;
  startTime: number;
  endTime: number;
  revision: number;
  visibility: string;
  source: 'warcraftlogs' | 'demo';
  players: Player[];
  petOwners?: Record<number, number>;
  fights: Fight[];
  zone: string;
  warnings: string[];
};
export type Evidence = {
  fightId: number;
  timestamp: number;
  abilityId?: number;
  ability: string;
  kind:
    | 'death'
    | 'mechanic'
    | 'mechanic-observed'
    | 'defensive'
    | 'interrupt'
    | 'dispel'
    | 'healing'
    | 'tank'
    | 'damage';
  description: string;
  amount?: number;
  confidence: 'observed' | 'inferred';
  ruleId?: string;
  url: string | null;
};
export type Metric = {
  mechanics?: MechanicResult[];
  activity?: ActivityFacts;
  actorId: number;
  damage: number;
  healing: number;
  damageTaken: number;
  aliveMs: number;
  deaths: number;
  interrupts: number;
  dispels: number;
  defensives: number;
  defensiveSpells: { id: number; name: string; count: number }[];
  mechanicFailures: number | null;
  mechanicOpportunities: number | null;
  utilitySuccesses: number | null;
  utilityOpportunities: number | null;
  outputPercentile: number | null;
  evidence: Evidence[];
  overhealing?: number | null;
  healingCooldowns?: number;
  taunts?: number;
  ravageHits?: number | null;
  ravageVulnerableHits?: number | null;
  tank?: TankFacts;
  evaluated?: {
    mechanics?: MechanicResult[];
    aliveMs: number;
    mechanicFailures: number | null;
    mechanicOpportunities: number | null;
    deaths: number;
    tank?: TankFacts;
    activity?: ActivityFacts;
  };
};
export type ActivityFacts = {
  activeMs: number;
  eligibleMs: number;
  activeWindows: number;
  eligibleWindows: number;
};
export type MechanicResult = {
  ruleId: string;
  name: string;
  kind: string;
  weight: number;
  opportunities: number;
  failures: number;
  unknown: number;
  observed: number;
  detail: string;
  source: string;
  abilityIds: number[];
  breakdown?: {
    abilityId: number;
    name: string;
    damage: number;
    hits: number;
    applications: number;
    casts: number;
    utility: number;
  }[];
  events: {
    timestamp: number;
    outcome: 'passed' | 'failed' | 'observed' | 'unknown';
    detail: string;
    url: string | null;
  }[];
};
export type PlayerPullReview = {
  fightId: number;
  role: Role;
  assessment: RoleAssessment;
  aliveMs: number;
  durationMs: number;
  deaths: number;
  damage: number;
  healing: number;
  mechanics: Pick<
    MechanicResult,
    'ruleId' | 'opportunities' | 'failures' | 'unknown' | 'observed' | 'events' | 'breakdown'
  >[];
  summary: string;
};
export type RecentAnalysis = {
  id: string;
  title: string;
  reportCode: string;
  generatedAt: string;
  bosses: number;
  pulls: number;
  players: number;
  version: string;
};
export type TankFacts = {
  profile: string;
  primaryProtection: string;
  snapshot: boolean;
  meleeEvents: number;
  knownMeleeEvents: number;
  protectedMeleeEvents: number;
  unknownMeleeEvents: number;
  protectionGapEpisodes: number;
  resourceHits: number;
  largeHits: number;
  largeHitsWithDefense: number;
  deathsUnderPressure: number;
  selfHealing: number;
  pressureMs: number;
  responseKnownWindows?: number;
  responseCoveredWindows?: number;
  responseUnknownWindows?: number;
  tasks?: TankTask[];
};
export type TankTaskCategory = 'duties' | 'defense' | 'safety' | 'utility' | 'output';
export type TankTask = {
  actorId: number;
  fightId: number;
  incidentId: string;
  timestamp: number;
  ruleId: string;
  category: TankTaskCategory;
  weight: number;
  earned: number | null;
  verified: boolean;
};
export type TankGrade = {
  score: number | null;
  lowerBound: number;
  upperBound: number;
  coverage: number;
  complete: boolean;
  knownIncidents: number;
  unknownIncidents: number;
  categories: Record<
    TankTaskCategory,
    { score: number | null; weight: number; known: number; unknown: number }
  >;
};
export type TankReview = {
  version: string;
  status: 'complete' | 'partial' | 'insufficient';
  profiles: string[];
  facts: Omit<TankFacts, 'profile' | 'primaryProtection' | 'snapshot' | 'tasks'>;
  protectionPercent: number | null;
  pullsMeasured: number;
  pullsMissing: number;
  reasons: string[];
  grade: TankGrade;
};
export type PullData = {
  fight: Fight;
  metrics: Metric[];
  complete: boolean;
  warnings: string[];
  mechanicRule: string | null;
  mechanicScope?: 'partial' | 'complete';
  wipeTailMs: number | null;
  evaluation?: { endTime: number; reason: 'raid-collapse' | 'boss-enrage'; excludedMs: number };
};
export type Selection = {
  encounterId: number | null;
  difficulty: number | null;
  mode: Mode;
  fightIds: number[] | null;
  excludeWipeTail: boolean;
};
export type CategoryScore = {
  score: number | null;
  weight: number;
  applied: boolean;
  explanation: string;
};
export type PlayerBossScore = {
  assessment?: RoleAssessment;
  encounterId: number;
  name: string;
  score: number | null;
  relativeScore: number | null;
  coverage: number;
  pulls: number;
  categories: Record<Category, CategoryScore>;
  provisional?: boolean;
  tankReview?: TankReview;
};
export type RankedPlayer = Player & {
  pullReviews?: PlayerPullReview[];
  assessment?: RoleAssessment;
  rank: number | null;
  score: number | null;
  provisional: boolean;
  coverage: number;
  confidence: 'limited' | 'developing' | 'strong';
  pulls: number;
  bosses: number;
  bossCoverage: number;
  comparedBosses: number;
  durationMs: number;
  aliveMs: number;
  deaths: number;
  damage: number;
  healing: number;
  damageTaken: number;
  interrupts: number;
  dispels: number;
  defensives: number;
  mechanicFailures: number | null;
  mechanicOpportunities: number | null;
  categories: Record<Category, CategoryScore>;
  perBoss: PlayerBossScore[];
  evidence: Evidence[];
  notes: string[];
  roleRank?: number | null;
  rolePeers?: number;
  evaluatedAliveMs?: number;
  evaluatedDurationMs?: number;
  lateDeaths?: number;
  overhealing?: number | null;
  healingCooldowns?: number;
  taunts?: number;
  ravageHits?: number | null;
  ravageVulnerableHits?: number | null;
  tankReview?: TankReview;
};
export type RoleFactorKey = 'survival' | 'activity' | 'output' | 'protection' | 'mechanics';
export type RoleFactor = {
  key: RoleFactorKey;
  name: string;
  weight: number;
  score: number | null;
  measuredWeight: number;
  points: number;
  neutralPoints: number;
  explanation: string;
};
export type RoleAssessment = {
  version: string;
  score: number;
  lower: number;
  upper: number;
  coverage: number;
  factors: RoleFactor[];
  notes: string[];
  contexts: {
    encounterId?: number;
    name?: string;
    difficulty: number;
    role: Role;
    pulls: number;
    score: number;
  }[];
};
export type Finding = {
  title: string;
  detail: string;
  confidence: 'observed' | 'inferred';
  fightIds: number[];
  actorId?: number;
  evidence?: Evidence[];
};
export type Analysis = {
  mechanicCatalogue?: Record<
    string,
    Pick<MechanicResult, 'ruleId' | 'name' | 'kind' | 'weight' | 'detail' | 'source' | 'abilityIds'>
  >;
  version: string;
  generatedAt: string;
  report: Report;
  selection: Selection;
  players: RankedPlayer[];
  pulls: Omit<PullData, 'metrics'>[];
  findings: Finding[];
  warnings: string[];
  summary: {
    pulls: number;
    kills: number;
    wipes: number;
    bosses: number;
    players: number;
    durationMs: number;
    coverage: number;
    complete: boolean;
  };
  methodology: {
    weights: Record<Category, number>;
    bossWeighting: string;
    rules: string[];
    limitations: string[];
  };
};
export type Job = {
  id: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  progress: number;
  message: string;
  createdAt: string;
  result?: Analysis;
  error?: string;
  errorCode?: string;
  reportCode: string;
  selection: Selection;
  demo: boolean;
};
export type Status = {
  version: string;
  liveConfigured: boolean;
  demoAvailable: boolean;
  mode: string;
};
