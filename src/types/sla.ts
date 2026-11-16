import { UserRole } from './index';

export type SlaPeriod = 'today' | '7d' | 'mtd';
export type SlaTier = 'EXCELLENT' | 'GOOD' | 'WARNING' | 'CRITICAL' | 'NO_DATA';

export type SlaActionType =
  | 'TEGUR_KORLAP'
  | 'ISSUE_SP1'
  | 'MASS_ALERT_KORLAP'
  | 'ESCALATE_DISPATCH'
  | 'BYPASS_PERMIT'
  | 'SEND_ASSISTANCE'
  | 'PING_TECHNICIAN';

export interface SlaPksRuleConfig {
  clauseReference: string;
  bonusEnabled: boolean;
  bonusRatePerCompliantWo: number;
  toleranceMinRate: number;
  penaltyRatePerBreachWo: number;
  isCustomConfigured: boolean;
}

export interface SlaThresholdConfig {
  globalSlaTarget: number;
  excellentMin: number;
  goodMin: number;
  warningMin: number;
  ftrTarget: number;
  maxDispatchResponseMinutes: number;
  opmMaxLossDbm: number; // e.g. -22.0 means optical power >= -22.0 dBm is valid (redaman < 22 dBm)
  requiredPhotoCount: number;
  criticalRemainingMinutes: number;
  defaultDailyQuotaPerTech: number;
  ruleVersionLabel: string;
  pksRules: SlaPksRuleConfig;
}

export interface SlaGovernanceActionRecord {
  id: string;
  actionType: SlaActionType;
  ticketId?: string;
  woNumber?: string;
  contractorId?: string;
  contractorName?: string;
  leaderName?: string;
  leaderPhone?: string;
  targetInstallerName?: string;
  message: string;
  reason?: string;
  performedBy: string;
  performedByRole: UserRole;
  createdAt: string;
}

export interface SlaVendorRow {
  rank: number;
  contractorId: string;
  contractorName: string;
  contractorCode: string;
  primaryArea: string;
  coverageAreas: string[];
  activeTechniciansCount: number;
  leaderName: string;
  leaderPhone: string;
  slaStatus: SlaTier;
  slaRate: number | null;
  targetGap: number | null;
  volumeWo: number;
  okCount: number;
  wipCount: number;
  lateCount: number;
  onTimeRate: number | null;
  ftrRate: number | null;
  avgResponseMinutes: number | null;
  quotaUsed: number;
  quotaTotal: number;
  quotaUtilizationRate: number | null;
  breachWoCount: number;
  latestGovernanceAction?: SlaGovernanceActionRecord | null;
}

export interface SlaSlotTrendItem {
  slotTime: string;
  shortLabel: string;
  volume: number;
  okCount: number;
  wipCount: number;
  lateCount: number;
  slaRate: number | null;
  avgResponseMinutes: number | null;
}

export interface SlaInsightItem {
  id: string;
  tone: 'warning' | 'success' | 'info';
  title: string;
  description: string;
}

export interface SlaComplianceMatrixItem {
  id: string;
  title: string;
  subtitle: string;
  complianceRate: number | null;
  passedCount: number;
  totalCount: number;
  statusTone: 'emerald' | 'purple' | 'amber' | 'rose';
}

export interface SlaBreachTicketItem {
  ticketId: string;
  woNumber: string;
  customerName: string;
  address: string;
  area: string;
  contractorId: string;
  contractorName: string;
  installerName: string;
  installerPhone: string;
  leaderName: string;
  leaderPhone: string;
  slotTime: string;
  appointmentDate: string;
  slaDeadlineAt: string | null;
  minutesRemaining: number;
  isOverdue: boolean;
  issueSummary: string;
  statusWOInstaller: string;
  workSessionStatus: string;
  lastAction?: SlaGovernanceActionRecord | null;
}

export interface SlaPksLedgerItem {
  contractorId: string;
  contractorName: string;
  slaRate: number | null;
  slaStatus: SlaTier;
  volumeWo: number;
  compliantWoCount: number;
  breachWoCount: number;
  amount: number;
  ledgerType: 'BONUS' | 'NEUTRAL' | 'PENALTY';
  explanation: string;
}

export interface SlaTelemetryPayload {
  generatedAt: string;
  operationalDateWIB: string;
  period: SlaPeriod;
  dateRange: {
    start: string;
    end: string;
  };
  clusterLabel: string;
  databaseSource: 'supabase' | 'local_json';
  config: SlaThresholdConfig;
  configVersion: number;
  isConfigPersistedInDb: boolean;
  kpis: {
    globalComplianceRate: number | null;
    globalTarget: number;
    complianceGap: number | null;
    compliantWoCount: number;
    evaluatedWoCount: number;
    complianceStatus: 'ON_TARGET' | 'WARNING' | 'CRITICAL' | 'NO_DATA';
    totalDistributedWo: number;
    okCount: number;
    wipCount: number;
    latCount: number;
    ftrRate: number | null;
    ftrTarget: number;
    ftrPassCount: number;
    ftrEvaluatedCount: number;
    ftrStatus: 'STABIL' | 'PERHATIAN' | 'KRITIS' | 'NO_DATA';
    photoOpmComplianceRate: number | null;
    photoOpmValidCount: number;
    photoOpmEvaluatedCount: number;
    opmThresholdDbm: number;
    requiredPhotoCount: number;
    criticalBreachCount: number;
    criticalVendorCount: number;
  };
  vendorLeaderboard: SlaVendorRow[];
  slotTrend: SlaSlotTrendItem[];
  slotInsights: SlaInsightItem[];
  operationalMatrix: SlaComplianceMatrixItem[];
  breachQueue: SlaBreachTicketItem[];
  pksLedger: {
    items: SlaPksLedgerItem[];
    totalNetAmount: number;
    totalBonusAmount: number;
    totalPenaltyAmount: number;
    clauseReference: string;
    isCustomConfigured: boolean;
  };
  recentGovernanceLogs: SlaGovernanceActionRecord[];
  filterOptions: {
    areas: string[];
    contractors: { id: string; name: string; code?: string }[];
  };
}
