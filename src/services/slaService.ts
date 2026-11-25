import * as XLSX from 'xlsx';
import { getAuthHeaders } from './authService';
import type {
  SlaPeriod,
  SlaThresholdConfig,
  SlaActionType,
  SlaGovernanceActionRecord,
  SlaTelemetryPayload
} from '../types/sla';

export interface SlaTelemetryQuery {
  period: SlaPeriod;
  area?: string;
  contractor?: string;
}

export interface SlaConfigResponse {
  config: SlaThresholdConfig;
  version: number;
  isPersistedInDb: boolean;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export interface ExecuteSlaActionPayload {
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
  postToLiveChat?: boolean;
}

async function parseJsonSafe(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function fetchSlaTelemetry(query: SlaTelemetryQuery): Promise<SlaTelemetryPayload> {
  const params = new URLSearchParams();
  params.set('period', query.period);
  if (query.area && query.area !== 'ALL') params.set('area', query.area);
  if (query.contractor && query.contractor !== 'ALL') params.set('contractor', query.contractor);

  const res = await fetch(`/api/sla/telemetry?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json'
    }
  });

  const data = await parseJsonSafe(res);
  if (!res.ok || !data?.success || !data?.telemetry) {
    throw new Error(data?.error || `Gagal memuat telemetri SLA (HTTP ${res.status}).`);
  }
  return data.telemetry as SlaTelemetryPayload;
}

export async function fetchSlaConfig(): Promise<SlaConfigResponse> {
  const res = await fetch('/api/sla/config', {
    method: 'GET',
    credentials: 'include',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json'
    }
  });
  const data = await parseJsonSafe(res);
  if (!res.ok || !data?.success || !data?.config) {
    throw new Error(data?.error || `Gagal memuat konfigurasi ambang batas SLA (HTTP ${res.status}).`);
  }
  return {
    config: data.config,
    version: data.version || 1,
    isPersistedInDb: Boolean(data.isPersistedInDb),
    updatedAt: data.updatedAt,
    updatedBy: data.updatedBy
  };
}

export async function saveSlaConfig(
  config: SlaThresholdConfig,
  options?: { expectedVersion?: number; forceOverwrite?: boolean; notes?: string }
): Promise<SlaConfigResponse> {
  const res = await fetch('/api/sla/config', {
    method: 'PUT',
    credentials: 'include',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      config,
      expectedVersion: options?.expectedVersion,
      forceOverwrite: options?.forceOverwrite,
      notes: options?.notes,
      markCustomConfigured: true
    })
  });

  const data = await parseJsonSafe(res);
  if (!res.ok || !data?.success || !data?.config) {
    throw new Error(data?.error || `Gagal menyimpan konfigurasi SLA (HTTP ${res.status}).`);
  }
  return {
    config: data.config,
    version: data.version || 1,
    isPersistedInDb: true,
    updatedAt: data.updatedAt,
    updatedBy: data.updatedBy
  };
}

export async function executeSlaAction(payload: ExecuteSlaActionPayload): Promise<SlaGovernanceActionRecord> {
  const res = await fetch('/api/sla/actions', {
    method: 'POST',
    credentials: 'include',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJsonSafe(res);
  if (!res.ok || !data?.success || !data?.action) {
    throw new Error(data?.error || `Gagal menjalankan tindakan SLA (HTTP ${res.status}).`);
  }
  return data.action as SlaGovernanceActionRecord;
}

export function exportSlaScorecardXlsx(telemetry: SlaTelemetryPayload): string {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Ringkasan Eksekutif
  const summaryRows = [
    ['MoraJaws SLA Telemetry & Vendor Performance Scorecard'],
    ['Generated At (ISO)', telemetry.generatedAt],
    ['Operational Date (WIB)', telemetry.operationalDateWIB],
    ['Period', `${telemetry.period.toUpperCase()} (${telemetry.dateRange.start} s/d ${telemetry.dateRange.end})`],
    ['Database Source', telemetry.databaseSource],
    ['Rule Version', telemetry.config.ruleVersionLabel],
    [],
    ['Metrik KPI', 'Nilai', 'Target / Keterangan'],
    ['Kepatuhan SLA Global (%)', telemetry.kpis.globalComplianceRate !== null ? `${telemetry.kpis.globalComplianceRate}%` : 'Belum ada data', `Target ${telemetry.kpis.globalTarget}% (${telemetry.kpis.compliantWoCount}/${telemetry.kpis.evaluatedWoCount})`],
    ['Total WO Terdistribusi', telemetry.kpis.totalDistributedWo, `OK: ${telemetry.kpis.okCount} | WIP: ${telemetry.kpis.wipCount} | LATE: ${telemetry.kpis.latCount}`],
    ['First-Time-Right (FTR) (%)', telemetry.kpis.ftrRate !== null ? `${telemetry.kpis.ftrRate}%` : 'Belum ada data', `Target ${telemetry.kpis.ftrTarget}% (${telemetry.kpis.ftrPassCount}/${telemetry.kpis.ftrEvaluatedCount})`],
    ['Kepatuhan Foto & OPM (%)', telemetry.kpis.photoOpmComplianceRate !== null ? `${telemetry.kpis.photoOpmComplianceRate}%` : 'Belum ada data', `${telemetry.kpis.photoOpmValidCount}/${telemetry.kpis.photoOpmEvaluatedCount} Valid (Loss > ${telemetry.kpis.opmThresholdDbm} dBm, Min ${telemetry.kpis.requiredPhotoCount} Foto)`],
    ['Antrean Kritis Breach SLA', telemetry.kpis.criticalBreachCount, `${telemetry.kpis.criticalVendorCount} Vendor Terdampak (< ${telemetry.config.criticalRemainingMinutes} mnt)`]
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan_SLA');

  // Sheet 2: Leaderboard Vendor
  const vendorSheetRows = telemetry.vendorLeaderboard.map(v => ({
    Rank: v.rank,
    Vendor: v.contractorName,
    Kode: v.contractorCode,
    Area: v.primaryArea,
    'Teknisi Aktif': v.activeTechniciansCount,
    Korlap: v.leaderName,
    'Status SLA': v.slaStatus,
    'SLA Rate (%)': v.slaRate ?? '-',
    'Gap Target (%)': v.targetGap ?? '-',
    'Volume WO': v.volumeWo,
    'WO On-Time': v.okCount,
    'WO WIP': v.wipCount,
    'WO Late': v.lateCount,
    'FTR Pass (%)': v.ftrRate ?? '-',
    'Avg Response (Mnt)': v.avgResponseMinutes ?? '-',
    'Kuota Terpakai': `${v.quotaUsed}/${v.quotaTotal}`,
    'Utilisasi Kuota (%)': v.quotaUtilizationRate ?? '-'
  }));
  const wsVendors = XLSX.utils.json_to_sheet(vendorSheetRows);
  XLSX.utils.book_append_sheet(wb, wsVendors, 'Leaderboard_Vendor');

  // Sheet 3: Antrean Breach SLA
  const breachSheetRows = telemetry.breachQueue.map(b => ({
    'No WO': b.woNumber,
    Pelanggan: b.customerName,
    Area: b.area,
    Vendor: b.contractorName,
    Teknisi: b.installerName,
    Korlap: b.leaderName,
    Slot: b.slotTime,
    'Sisa Waktu (Mnt)': b.minutesRemaining,
    Status: b.isOverdue ? 'OVERDUE' : 'KRITIS',
    'Kendala / Catatan': b.issueSummary
  }));
  const wsBreach = XLSX.utils.json_to_sheet(breachSheetRows);
  XLSX.utils.book_append_sheet(wb, wsBreach, 'Antrean_Breach_SLA');

  // Sheet 4: Proyeksi Insentif & Penalti PKS
  const pksRows = telemetry.pksLedger.items.map(p => ({
    Vendor: p.contractorName,
    'SLA Rate (%)': p.slaRate ?? '-',
    Status: p.slaStatus,
    'WO Patuh': p.compliantWoCount,
    'WO Breach': p.breachWoCount,
    Tipe: p.ledgerType,
    'Nominal Proyeksi (IDR)': p.amount,
    Keterangan: p.explanation
  }));
  const wsPks = XLSX.utils.json_to_sheet(pksRows);
  XLSX.utils.book_append_sheet(wb, wsPks, 'Proyeksi_PKS');

  const filename = `MoraJaws_SLA_Scorecard_${telemetry.operationalDateWIB}_${telemetry.period}.xlsx`;
  XLSX.writeFile(wb, filename);
  return filename;
}
