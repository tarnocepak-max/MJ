import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as XLSX from 'xlsx';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRightLeft,
  ArrowUpRight,
  Award,
  BarChart3,
  Bike,
  Bolt,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Compass,
  ExternalLink,
  Eye,
  Inbox,
  Layers,
  MapPin,
  Map as MapIcon,
  MessageSquare,
  Navigation,
  Phone,
  PieChart,
  Plus,
  RefreshCw,
  Scale,
  Send,
  ShieldCheck,
  Sliders,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users2,
  Wrench,
  X
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { Ticket, User, WOKpiFilterKey } from '../../types/index.ts';
import { getTicketAppointmentDate, formatAppointmentDateDisplay } from '../../services/appointmentDateParser';
import { formatJakartaTimeOnly } from '../../services/workSessionService';
import {
  getTicketCanonicalApprovalStatus,
  getTicketCanonicalReportStatus,
  isTicketAssigned,
  isTicketCheckedIn,
  isTicketClosed
} from '../../services/woLifecycleService';
import {
  buildTechnicianCapacitySummaries,
  computeAutoBalancePlan,
  DEFAULT_LEADER_QUOTA_CONFIG,
  fetchLeaderQuotaConfig,
  LeaderQuotaConfig,
  normalizeSlotIndex,
  TechnicianCapacitySummary
} from '../../services/leaderQuotaService';
import { buildWhatsAppClickToChatUrl, isValidPhoneNumber } from '../../services/whatsappService';
import { getTicketRegisteredCoordinates, isValidCoordinatePair } from '../../services/mapsService';
import { ResponsiveModal } from '../common/ResponsiveModal';

export interface StitchLeaderCommandHubProps {
  onNavigate: (tab: string) => void;
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp?: (ticket: Ticket) => void;
  onDrillDown?: (filterKey: WOKpiFilterKey, filters?: { contractor?: string; area?: string }) => void;
  /** Optional overrides when rendered inside LeaderPortal */
  onSwitchLeaderTab?: (
    tab: 'dashboard' | 'wo_assignment' | 'reassign_wo' | 'progress_dashboard' | 'installer_mgmt' | 'quota_settings' | 'contractor_recap',
    statusFilterPreset?: 'all' | 'unassigned' | 'assigned' | 'waiting' | 'in_progress' | 'completed' | 'pending' | 'problem'
  ) => void;
}

const isScopeTextMatch = (a?: string | null, b?: string | null): boolean => {
  const na = String(a || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const nb = String(b || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
};

const getInitials = (name?: string): string => {
  const parts = String(name || 'TK')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'TK';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
};

const formatWaitElapsed = (iso?: string): string => {
  if (!iso) return 'Menunggu';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'Baru masuk';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hrs = Math.floor(mins / 60);
  const remM = mins % 60;
  return `${hrs}j ${remM}m`;
};

const formatDurationShort = (minutes: number): string => {
  if (!Number.isFinite(minutes) || minutes <= 0) return '-';
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded}m`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m > 0 ? `${h}j ${m}m` : `${h}j`;
};

interface MapRadarPin {
  ticket: Ticket;
  lat: number;
  lng: number;
  color: string;
  label: string;
}

const SectorGeofenceMiniRadar: React.FC<{
  pins: MapRadarPin[];
  sectorLabel: string;
  verifiedHouseCount: number;
  subAreaSummaryText: string;
  avgDbmLabel: string;
}> = ({ pins, sectorLabel, verifiedHouseCount, subAreaSummaryText, avgDbmLabel }) => {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [tileOffline, setTileOffline] = useState(false);

  const pinSignature = useMemo(
    () => pins.map(p => `${p.ticket.id}:${p.lat.toFixed(4)},${p.lng.toFixed(4)}:${p.color}`).join('|'),
    [pins]
  );

  useEffect(() => {
    const el = mapElRef.current;
    if (!el || pins.length === 0) return;

    if (mapRef.current) {
      try {
        mapRef.current.remove();
      } catch {}
      mapRef.current = null;
    }

    const avgLat = pins.reduce((s, p) => s + p.lat, 0) / pins.length;
    const avgLng = pins.reduce((s, p) => s + p.lng, 0) / pins.length;

    const map = L.map(el, {
      center: [avgLat, avgLng],
      zoom: 13,
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false
    });

    const tile = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true
    });
    tile.on('tileerror', () => setTileOffline(true));
    tile.on('tileload', () => setTileOffline(false));
    tile.addTo(map);

    const bounds: L.LatLngExpression[] = [];
    pins.forEach(p => {
      bounds.push([p.lat, p.lng]);
      const icon = L.divIcon({
        className: 'mj-leader-radar-pin',
        html: `<div style="width:16px;height:16px;border-radius:9999px;background:${p.color};border:2.5px solid #ffffff;box-shadow:0 2px 8px rgba(15,23,42,0.5);"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });
      const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
      marker.bindTooltip(`${p.ticket.woNumber} • ${p.label}`, { direction: 'top', offset: [0, -8] });
    });

    if (bounds.length > 1) {
      try {
        map.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [28, 28], maxZoom: 15 });
      } catch {}
    }

    mapRef.current = map;
    const t = setTimeout(() => {
      try {
        map.invalidateSize();
      } catch {}
    }, 150);

    return () => {
      clearTimeout(t);
      try {
        map.remove();
      } catch {}
      mapRef.current = null;
    };
  }, [pinSignature, pins]);

  return (
    <div className="relative w-full h-64 rounded-xl overflow-hidden shadow-inner bg-[#EDF3F8] dark:bg-[#120926] border border-[#DDE6F0] dark:border-[#35105E]">
      {pins.length > 0 ? (
        <div ref={mapElRef} className="w-full h-full z-0" />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-center px-6 bg-gradient-to-br from-[#F0EDFF] via-[#F8FAFD] to-[#DDF4F4] dark:from-[#1B1033] dark:to-[#120A22]">
          <Compass className="w-8 h-8 text-[#5145A6] dark:text-[#dab9ff] mb-2 opacity-80" />
          <div className="text-xs font-bold text-[#26364A] dark:text-white">
            Menunggu Koordinat Geotag Lapangan
          </div>
          <div className="text-[11px] text-[#8492A5] dark:text-[#CEC0E8] mt-1">
            Pin GIS akan muncul otomatis setelah teknisi mengirim Check-In Camera / GPS rumah pelanggan.
          </div>
        </div>
      )}

      {/* Tactical HUD Overlay */}
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-[#26364A]/85 via-[#26364A]/15 dark:from-[#1f1638]/85 dark:via-[#1f1638]/15 to-transparent flex flex-col justify-between p-3 z-[400]">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="px-2 py-1 rounded bg-black/65 backdrop-blur-sm text-white font-mono text-[10px] font-bold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            RADAR: {sectorLabel.toUpperCase()} ({pins.length > 0 ? 'ACTIVE' : 'STANDBY'})
          </span>
          <span className="px-2 py-0.5 rounded bg-[#6657C8]/90 dark:bg-[#58149c]/90 backdrop-blur-sm text-white font-mono text-[10px] font-bold">
            {avgDbmLabel !== '-' ? `AVG RX: ${avgDbmLabel}` : `${pins.length} PIN GIS`}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 bg-black/75 backdrop-blur-md p-2 rounded-lg border border-[#DCE3F2]/45 dark:border-[#a380fe]/45 text-white">
            <Camera className="w-4 h-4 text-[#DDF4F4] dark:text-[#dab9ff] shrink-0" />
            <div className="min-w-0">
              <div className="text-[11px] font-bold leading-tight truncate">
                {verifiedHouseCount} Rumah Terverifikasi Foto Geotag
              </div>
              <div className="text-[10px] text-slate-200 truncate">
                {subAreaSummaryText || (tileOffline ? 'Mode koordinat aktif' : 'Monitoring sektor real-time')}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between text-[10.5px] text-slate-100 font-medium px-0.5">
            <span>{pins.length} Titik Koordinat Terpetakan</span>
            <span className="text-emerald-300 font-mono font-bold">STATUS: LIVE</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export const StitchLeaderCommandHub: React.FC<StitchLeaderCommandHubProps> = ({
  onNavigate,
  onSelectTicket,
  onOpenWhatsApp,
  onDrillDown,
  onSwitchLeaderTab
}) => {
  const {
    currentUser,
    scopedTickets,
    users,
    todayWIB,
    contractorsList,
    areasList,
    databaseStatus,
    syncStatus,
    lastSyncTime,
    refreshActiveTickets,
    refreshDatabaseData,
    assignTicketPersonnel,
    bulkAssignPersonnel,
    setActiveKpiDrilldown,
    setKpiContractorFilter,
    setKpiAreaFilter
  } = useApp();
  const { toast } = useToast();
  const { isCompactUI } = useResponsiveViewport();

  const leaderContractor = currentUser?.contractor || '';
  const leaderArea = currentUser?.area || '';
  const displayContractor = leaderContractor || (contractorsList?.[0] || 'Mitra Kontraktor');
  const displayArea = leaderArea || (areasList?.[0] || 'Semua Sektor');

  const [quotaConfig, setQuotaConfig] = useState<LeaderQuotaConfig>(() => ({
    ...DEFAULT_LEADER_QUOTA_CONFIG,
    contractorName: displayContractor
  }));
  const [autoRefresh15s, setAutoRefresh15s] = useState(false);
  const [isRefreshingNow, setIsRefreshingNow] = useState(false);
  const [feedFilter, setFeedFilter] = useState<'all' | 'checkin' | 'issue' | 'complete'>('all');

  // Instant Disposition / Auto-Balance Modal state
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignModalMode, setAssignModalMode] = useState<'manual' | 'auto'>('manual');
  const [modalTicketId, setModalTicketId] = useState<string>('');
  const [modalInstallerName, setModalInstallerName] = useState<string>('');
  const [modalSlotTime, setModalSlotTime] = useState<string>('');
  const [isSubmittingAssign, setIsSubmittingAssign] = useState(false);

  // Load Leader Quota config from real backend API
  useEffect(() => {
    let active = true;
    const scope = leaderContractor || displayContractor;
    fetchLeaderQuotaConfig(scope)
      .then(res => {
        if (active && res.success && res.config) {
          setQuotaConfig(res.config);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [leaderContractor, displayContractor]);

  // Optional 15-second Live Feed auto-refresh
  useEffect(() => {
    if (!autoRefresh15s) return;
    const id = window.setInterval(() => {
      refreshActiveTickets().catch(() => {});
    }, 15000);
    return () => window.clearInterval(id);
  }, [autoRefresh15s, refreshActiveTickets]);

  // Scoped active tickets (today WIB)
  const sectorTicketsAll = useMemo(() => {
    return (scopedTickets || []).filter(t => {
      if (!t || t.isArchived || t.isDeleted) return false;
      if (currentUser.role === 'super_admin') return true;
      const tContr = t.contactorName || t.contractorName || '';
      if (leaderContractor && tContr && !isScopeTextMatch(tContr, leaderContractor)) return false;
      if (leaderArea && t.area && !isScopeTextMatch(t.area, leaderArea)) {
        const directMatch =
          (t.leaderId && t.leaderId === currentUser.id) ||
          (t.leaderName && isScopeTextMatch(t.leaderName, currentUser.name));
        if (!directMatch) return false;
      }
      return true;
    });
  }, [scopedTickets, currentUser.role, currentUser.id, currentUser.name, leaderContractor, leaderArea]);

  const todayTickets = useMemo(() => {
    return sectorTicketsAll.filter(t => getTicketAppointmentDate(t) === todayWIB);
  }, [sectorTicketsAll, todayWIB]);

  // Scoped active installers
  const myInstallers = useMemo(() => {
    return (users || []).filter(u => {
      if (u.role !== 'installer' || u.active === false || u.isArchived || u.isDeleted) return false;
      if (currentUser.role === 'super_admin') return true;
      if (leaderContractor && !isScopeTextMatch(u.contractor, leaderContractor)) return false;
      if (leaderArea && u.area && !isScopeTextMatch(u.area, leaderArea)) return false;
      return true;
    });
  }, [users, currentUser.role, leaderContractor, leaderArea]);

  const allScopedInstallersIncludingInactive = useMemo(() => {
    return (users || []).filter(u => {
      if (u.role !== 'installer' || u.isArchived || u.isDeleted) return false;
      if (currentUser.role === 'super_admin') return true;
      if (leaderContractor && !isScopeTextMatch(u.contractor, leaderContractor)) return false;
      if (leaderArea && u.area && !isScopeTextMatch(u.area, leaderArea)) return false;
      return true;
    });
  }, [users, currentUser.role, leaderContractor, leaderArea]);

  // Technician capacity summaries from canonical service
  const technicianSummaries = useMemo(() => {
    return buildTechnicianCapacitySummaries({
      installers: myInstallers,
      todayTickets,
      quotaConfig,
      targetDate: todayWIB
    });
  }, [myInstallers, todayTickets, quotaConfig, todayWIB]);

  // Rich per-technician metrics (done, active/in-progress, revision/pending, geotag %, avg Rx)
  interface RichTechnicianRow {
    summary: TechnicianCapacitySummary;
    doneCount: number;
    checkedInCount: number;
    otwAssignedCount: number;
    approvalPendingCount: number;
    issueOrRevisionCount: number;
    issueNote: string;
    avgDbm: number | null;
    housePhotoPct: number;
    activeTickets: Ticket[];
  }

  const richTechRows: RichTechnicianRow[] = useMemo(() => {
    const norm = (v?: string | null) => String(v || '').trim().toLowerCase();
    return technicianSummaries
      .map(summary => {
        const instTickets = todayTickets.filter(
          t => norm(t.installerName) === norm(summary.installer.name)
        );
        let doneCount = 0;
        let checkedInCount = 0;
        let otwAssignedCount = 0;
        let approvalPendingCount = 0;
        let issueOrRevisionCount = 0;
        let issueNote = '';
        let houseValid = 0;
        let houseEligible = 0;
        const dbmVals: number[] = [];

        instTickets.forEach(t => {
          const approval = getTicketCanonicalApprovalStatus(t);
          const rep = getTicketCanonicalReportStatus(t);
          const closed = isTicketClosed(t);
          const checkedIn = isTicketCheckedIn(t);

          if (closed || approval === 'APPROVED' || t.statusWOInstaller === 'Completed' || t.statusWOInstaller === 'Installed') {
            doneCount += 1;
          } else if (approval === 'REVISION' || t.statusWOInstaller === 'Pending Technical' || t.statusWOInstaller === 'Failed / Cancelled' || rep === 'PENDING') {
            issueOrRevisionCount += 1;
            if (!issueNote) {
              issueNote = t.rejectionReason || t.remarksWOInstaller || t.remarksAgent || t.clusterName || t.area || '';
            }
          } else if (approval === 'BUTUH APPROVAL') {
            approvalPendingCount += 1;
          } else if (checkedIn) {
            checkedInCount += 1;
          } else {
            otwAssignedCount += 1;
          }

          if (checkedIn || closed || approval !== 'NONE') {
            houseEligible += 1;
            const hasHouse =
              t.houseLocation?.geotagStatus === 'valid' ||
              t.technicalReport?.photoSlots?.some(s => s.slotKey === 'customer_house' && s.geotagStatus === 'valid') ||
              isValidCoordinatePair(t.houseLocation?.latitude, t.houseLocation?.longitude);
            if (hasHouse) houseValid += 1;
          }

          const rawDbm = t.rosetRedamanDbm ?? t.technicalReport?.opticalPowerDbm ?? t.technicalReport?.opticalPowerRx;
          const parsedDbm = rawDbm !== undefined && rawDbm !== null ? parseFloat(String(rawDbm)) : NaN;
          if (Number.isFinite(parsedDbm) && parsedDbm < 0 && parsedDbm > -50) {
            dbmVals.push(parsedDbm);
          }
        });

        const avgDbm = dbmVals.length > 0 ? dbmVals.reduce((a, b) => a + b, 0) / dbmVals.length : null;
        const housePhotoPct = houseEligible > 0 ? Math.round((houseValid / houseEligible) * 100) : 100;

        return {
          summary,
          doneCount,
          checkedInCount,
          otwAssignedCount,
          approvalPendingCount,
          issueOrRevisionCount,
          issueNote,
          avgDbm,
          housePhotoPct,
          activeTickets: instTickets
        };
      })
      .sort((a, b) => {
        // Put issues first, then active/full, then available
        if (a.issueOrRevisionCount !== b.issueOrRevisionCount) {
          return b.issueOrRevisionCount - a.issueOrRevisionCount;
        }
        return b.summary.assignedCount - a.summary.assignedCount;
      });
  }, [technicianSummaries, todayTickets]);

  // Primary & Secondary KPI Metrics computed strictly from live data
  const metrics = useMemo(() => {
    const total = todayTickets.length;
    const unassignedTickets = todayTickets.filter(t => !isTicketAssigned(t));
    const assignedTickets = todayTickets.filter(t => isTicketAssigned(t));

    let checkedInProgress = 0;
    let otwAssigned = 0;
    let butuhApproval = 0;
    let complete = 0;
    let revisionCount = 0;
    let pendingTechnicalCount = 0;

    let houseValidCount = 0;
    let houseEligibleCount = 0;
    const durationMinsList: number[] = [];
    const rxDbmList: number[] = [];
    let submittedReportsCount = 0;

    todayTickets.forEach(t => {
      const assigned = isTicketAssigned(t);
      const checkedIn = isTicketCheckedIn(t);
      const approval = getTicketCanonicalApprovalStatus(t);
      const rep = getTicketCanonicalReportStatus(t);
      const closed = isTicketClosed(t);

      if (checkedIn || closed || approval !== 'NONE') {
        houseEligibleCount += 1;
        const validHouse =
          t.houseLocation?.geotagStatus === 'valid' ||
          t.technicalReport?.photoSlots?.some(s => s.slotKey === 'customer_house' && s.geotagStatus === 'valid') ||
          isValidCoordinatePair(t.houseLocation?.latitude, t.houseLocation?.longitude);
        if (validHouse) houseValidCount += 1;
      }

      if (approval !== 'NONE' || rep !== 'NONE' || Boolean(t.technicalReport)) {
        submittedReportsCount += 1;
      }

      if (closed || approval === 'APPROVED' || t.statusWOInstaller === 'Completed' || t.statusWOInstaller === 'Installed') {
        complete += 1;
        let dur = typeof t.workDurationMinutes === 'number' && t.workDurationMinutes > 0 ? t.workDurationMinutes : 0;
        if (!dur && t.checkInAt && t.checkOutAt) {
          const diff = (new Date(t.checkOutAt).getTime() - new Date(t.checkInAt).getTime()) / 60000;
          if (Number.isFinite(diff) && diff > 0 && diff < 720) dur = diff;
        }
        if (dur > 0) durationMinsList.push(dur);
      } else if (approval === 'BUTUH APPROVAL') {
        butuhApproval += 1;
      } else if (approval === 'REVISION') {
        revisionCount += 1;
      } else if (
        t.statusWOInstaller === 'Pending Technical' ||
        t.statusWOInstaller === 'Failed / Cancelled' ||
        rep === 'PENDING' ||
        rep === 'CANCEL'
      ) {
        pendingTechnicalCount += 1;
      } else if (assigned) {
        if (checkedIn) checkedInProgress += 1;
        else otwAssigned += 1;
      }

      const rawRx = t.rosetRedamanDbm ?? t.technicalReport?.opticalPowerDbm ?? t.technicalReport?.opticalPowerRx;
      const parsedRx = rawRx !== undefined && rawRx !== null ? parseFloat(String(rawRx)) : NaN;
      if (Number.isFinite(parsedRx) && parsedRx < 0 && parsedRx > -50) {
        rxDbmList.push(parsedRx);
      }
    });

    const totalDailyCapacity = technicianSummaries.reduce((acc, s) => acc + s.maxLimit, 0);
    const capacityFillPct =
      totalDailyCapacity > 0
        ? Math.min(100, Math.round((assignedTickets.length / totalDailyCapacity) * 1000) / 10)
        : 0;

    const progressLapanganTotal = checkedInProgress + otwAssigned;
    const kendalaRevisiTotal = revisionCount + pendingTechnicalCount;
    const slaPct = total > 0 ? Math.round((complete / total) * 1000) / 10 : 0;
    const avgDurationMin =
      durationMinsList.length > 0
        ? durationMinsList.reduce((a, b) => a + b, 0) / durationMinsList.length
        : 0;

    const houseGeotagPct =
      houseEligibleCount > 0 ? Math.round((houseValidCount / houseEligibleCount) * 1000) / 10 : 100;

    const ftrRatePct =
      submittedReportsCount > 0
        ? Math.max(0, Math.round(((submittedReportsCount - revisionCount) / submittedReportsCount) * 1000) / 10)
        : 100;

    const avgRxDbm =
      rxDbmList.length > 0 ? rxDbmList.reduce((a, b) => a + b, 0) / rxDbmList.length : null;

    const avgLoadPerTech =
      myInstallers.length > 0
        ? (assignedTickets.length / myInstallers.length).toFixed(1)
        : '0.0';

    const oldestUnassigned = unassignedTickets
      .slice()
      .sort(
        (a, b) =>
          new Date(a.importedAt || a.createdAt || 0).getTime() -
          new Date(b.importedAt || b.createdAt || 0).getTime()
      )[0];

    const availableTechsCount = technicianSummaries.filter(s => !s.isFull).length;

    const clusterNames = Array.from(
      new Set(
        todayTickets
          .map(t => String(t.clusterName || t.area || '').trim())
          .filter(Boolean)
      )
    );

    return {
      total,
      unassignedTickets,
      assignedCount: assignedTickets.length,
      checkedInProgress,
      otwAssigned,
      progressLapanganTotal,
      butuhApproval,
      complete,
      revisionCount,
      pendingTechnicalCount,
      kendalaRevisiTotal,
      slaPct,
      avgDurationLabel: formatDurationShort(avgDurationMin),
      totalDailyCapacity,
      capacityFillPct,
      houseValidCount,
      houseEligibleCount,
      houseGeotagPct,
      ftrRatePct,
      avgRxLabel: avgRxDbm !== null ? `${avgRxDbm.toFixed(1)} dBm` : '-',
      avgLoadPerTech,
      oldestUnassignedWait: oldestUnassigned
        ? formatWaitElapsed(oldestUnassigned.importedAt || oldestUnassigned.createdAt)
        : '-',
      availableTechsCount,
      clusterNames
    };
  }, [todayTickets, technicianSummaries, myInstallers.length]);

  // Radar GIS Pins derived from real todayTickets coordinates
  const radarPins: MapRadarPin[] = useMemo(() => {
    const list: MapRadarPin[] = [];
    todayTickets.forEach(t => {
      const coords = getTicketRegisteredCoordinates(t);
      if (!coords) return;
      const approval = getTicketCanonicalApprovalStatus(t);
      const closed = isTicketClosed(t);
      const checkedIn = isTicketCheckedIn(t);

      let color = '#64748B';
      let label = t.statusWOInstaller || 'OPEN';
      if (closed || approval === 'APPROVED' || t.statusWOInstaller === 'Completed') {
        color = '#10B981';
        label = 'Complete';
      } else if (approval === 'REVISION' || t.statusWOInstaller === 'Pending Technical') {
        color = '#DC2626';
        label = 'Kendala / Revisi';
      } else if (checkedIn) {
        color = '#A380FE';
        label = 'Check-In Valid';
      } else if (isTicketAssigned(t)) {
        color = '#6657C8';
        label = 'Assigned';
      } else {
        color = '#D97706';
        label = 'Unassigned';
      }

      list.push({
        ticket: t,
        lat: coords.latitude,
        lng: coords.longitude,
        color,
        label
      });
    });
    return list;
  }, [todayTickets]);

  // Sub-Area / Cluster Quota Breakdown derived from real todayTickets
  const subAreaBreakdown = useMemo(() => {
    const groups = new Map<
      string,
      {
        name: string;
        total: number;
        assigned: number;
        unassigned: number;
        complete: number;
        issues: number;
      }
    >();

    todayTickets.forEach(t => {
      const name = String(t.clusterName || t.area || displayArea || 'Umum').trim();
      const entry = groups.get(name) || {
        name,
        total: 0,
        assigned: 0,
        unassigned: 0,
        complete: 0,
        issues: 0
      };
      entry.total += 1;
      if (isTicketAssigned(t)) entry.assigned += 1;
      else entry.unassigned += 1;

      const approval = getTicketCanonicalApprovalStatus(t);
      if (isTicketClosed(t) || approval === 'APPROVED' || t.statusWOInstaller === 'Completed') {
        entry.complete += 1;
      } else if (
        approval === 'REVISION' ||
        t.statusWOInstaller === 'Pending Technical' ||
        t.statusWOInstaller === 'Failed / Cancelled'
      ) {
        entry.issues += 1;
      }
      groups.set(name, entry);
    });

    const rows = Array.from(groups.values()).sort((a, b) => b.total - a.total);
    const totalSectorCapacity = Math.max(metrics.totalDailyCapacity, metrics.total, 1);
    const totalAssignedWeight = Math.max(
      rows.reduce((sum, r) => sum + r.total, 0),
      1
    );

    return rows.slice(0, 4).map(r => {
      const proportionalCap = Math.max(
        r.total,
        Math.round((r.total / totalAssignedWeight) * totalSectorCapacity)
      );
      const pct = proportionalCap > 0 ? Math.min(100, Math.round((r.assigned / proportionalCap) * 1000) / 10) : 0;
      const spare = Math.max(0, proportionalCap - r.assigned);
      return {
        ...r,
        capacity: proportionalCap,
        pct,
        spare
      };
    });
  }, [todayTickets, displayArea, metrics.totalDailyCapacity, metrics.total]);

  // Live Feed Tickets sorted by recency & status filter
  const liveFeedTickets = useMemo(() => {
    const list = todayTickets.filter(t => {
      const approval = getTicketCanonicalApprovalStatus(t);
      const rep = getTicketCanonicalReportStatus(t);
      const closed = isTicketClosed(t);
      const checkedIn = isTicketCheckedIn(t);
      if (feedFilter === 'checkin') return checkedIn && !closed && approval !== 'APPROVED';
      if (feedFilter === 'complete') return closed || approval === 'APPROVED' || t.statusWOInstaller === 'Completed';
      if (feedFilter === 'issue') {
        return (
          approval === 'REVISION' ||
          t.statusWOInstaller === 'Pending Technical' ||
          t.statusWOInstaller === 'Failed / Cancelled' ||
          rep === 'PENDING' ||
          rep === 'RESCHEDULE'
        );
      }
      return true;
    });

    return list
      .slice()
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.checkInAt || b.createdAt || 0).getTime() -
          new Date(a.updatedAt || a.checkInAt || a.createdAt || 0).getTime()
      )
      .slice(0, 8);
  }, [todayTickets, feedFilter]);

  // Slot Appointment & Distribusi Jadwal (Pagi / Siang / Sore) computed from live todayTickets
  const slotScheduleBreakdown = useMemo(() => {
    const createBucket = (key: 'pagi' | 'siang' | 'sore', title: string, windowLabel: string) => ({
      key,
      title,
      windowLabel,
      total: 0,
      done: 0,
      inProgress: 0,
      unassigned: 0
    });
    const pagi = createBucket('pagi', 'Slot Pagi', '09:00 - 11:00 WIB');
    const siang = createBucket('siang', 'Slot Siang', '11:00 - 15:00 WIB');
    const sore = createBucket('sore', 'Slot Sore', '15:00 - 17:00 WIB');

    todayTickets.forEach(t => {
      const idx = normalizeSlotIndex(t.slotTime);
      const bucket = idx === 1 ? pagi : idx === 2 || idx === 3 ? siang : sore;
      bucket.total += 1;
      const approval = getTicketCanonicalApprovalStatus(t);
      const closed = isTicketClosed(t);
      if (closed || approval === 'APPROVED' || t.statusWOInstaller === 'Completed' || t.statusWOInstaller === 'Installed') {
        bucket.done += 1;
      } else if (!isTicketAssigned(t)) {
        bucket.unassigned += 1;
      } else {
        bucket.inProgress += 1;
      }
    });

    return [pagi, siang, sore].map(b => {
      const activeOrDone = b.done + b.inProgress;
      const progressPct = b.total > 0 ? Math.round((activeOrDone / b.total) * 100) : 0;
      const donePct = b.total > 0 ? Math.round((b.done / b.total) * 100) : 0;
      const runPct = b.total > 0 ? Math.round((b.inProgress / b.total) * 100) : 0;
      return { ...b, progressPct, donePct, runPct };
    });
  }, [todayTickets]);

  // Urgent tickets requiring Leader Reassignment attention (live from todayTickets)
  const urgentReassignInfo = useMemo(() => {
    const candidates = todayTickets
      .filter(t => {
        if (!isTicketAssigned(t)) return false;
        const closed = isTicketClosed(t);
        const approval = getTicketCanonicalApprovalStatus(t);
        if (closed || approval === 'APPROVED' || t.statusWOInstaller === 'Completed' || t.statusWOInstaller === 'Installed') {
          return false;
        }
        const rep = getTicketCanonicalReportStatus(t);
        return (
          approval === 'REVISION' ||
          t.statusWOInstaller === 'Pending Technical' ||
          t.statusWOInstaller === 'Failed / Cancelled' ||
          rep === 'PENDING' ||
          Boolean(t.rejectionReason?.trim())
        );
      })
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt || 0).getTime() -
          new Date(a.updatedAt || a.createdAt || 0).getTime()
      );

    const topTicket = candidates[0] || null;
    const recommendedReplacement = topTicket
      ? technicianSummaries
          .filter(
            s =>
              !s.isFull &&
              s.installer.name.toLowerCase().trim() !== String(topTicket.installerName || '').toLowerCase().trim()
          )
          .sort((a, b) => a.assignedCount - b.assignedCount)[0] || null
      : null;

    return {
      count: candidates.length,
      topTicket,
      recommendedReplacement
    };
  }, [todayTickets, technicianSummaries]);

  // Auto-balance plan preview computed cleanly from canonical service
  const autoBalancePlan = useMemo(() => {
    return computeAutoBalancePlan({
      targetTickets: metrics.unassignedTickets,
      installers: myInstallers,
      existingTodayTickets: todayTickets,
      quotaConfig
    });
  }, [metrics.unassignedTickets, myInstallers, todayTickets, quotaConfig]);

  // Navigation Helpers
  const navigateWithDrilldown = (
    filterKey: WOKpiFilterKey,
    leaderTabPreset?: 'all' | 'unassigned' | 'assigned' | 'waiting' | 'in_progress' | 'completed' | 'pending' | 'problem'
  ) => {
    if (leaderContractor) setKpiContractorFilter(leaderContractor);
    if (leaderArea) setKpiAreaFilter(leaderArea);
    setActiveKpiDrilldown({
      filterKey,
      dateWIB: todayWIB,
      contractor: leaderContractor || undefined,
      area: leaderArea || undefined
    });
    if (onDrillDown) {
      onDrillDown(filterKey, {
        contractor: leaderContractor || undefined,
        area: leaderArea || undefined
      });
      return;
    }
    if (onSwitchLeaderTab) {
      onSwitchLeaderTab('wo_assignment', leaderTabPreset);
      return;
    }
    onNavigate('wo_assignment');
  };

  const handleManualSync = async () => {
    if (isRefreshingNow) return;
    setIsRefreshingNow(true);
    try {
      await refreshDatabaseData();
      toast.success('Telemetri sektor & data Work Order berhasil disinkronkan.', 'Sinkronisasi Sukses');
    } catch {
      toast.error('Gagal menyinkronkan data ke cloud.', 'Sync Error');
    } finally {
      setIsRefreshingNow(false);
    }
  };

  const handleExportDailyRecap = () => {
    if (todayTickets.length === 0) {
      toast.warning('Belum ada data Work Order hari ini untuk diekspor.', 'Data Kosong');
      return;
    }
    try {
      const woRows = todayTickets.map((t, idx) => ({
        No: idx + 1,
        'No. WO': t.woNumber,
        'ID Pelanggan': t.idCustomer || '-',
        'Nama Pelanggan': t.customerName || '-',
        Area: t.area || '-',
        Cluster: t.clusterName || '-',
        Alamat: t.streetName || t.address || '-',
        'FAT / ODP': [t.fatCode || t.fat, t.fatPort].filter(Boolean).join(' ') || '-',
        'Slot Jadwal': t.slotTime || '-',
        Teknisi: t.installerName || 'BELUM ASSIGN',
        'Status Teknisi': t.statusWOInstaller || 'Unassigned',
        'Status Approval': getTicketCanonicalApprovalStatus(t),
        'Redaman Roset (dBm)': t.rosetRedamanDbm ?? t.technicalReport?.opticalPowerDbm ?? '-',
        'Check-In': t.checkInAt ? formatJakartaTimeOnly(t.checkInAt) : '-',
        'Check-Out': t.checkOutAt ? formatJakartaTimeOnly(t.checkOutAt) : '-'
      }));

      const techRows = richTechRows.map((r, idx) => ({
        No: idx + 1,
        'Nama Teknisi': r.summary.installer.name,
        Username: r.summary.installer.username,
        Area: r.summary.installer.area || displayArea,
        'Beban Hari Ini': `${r.summary.assignedCount} / ${r.summary.maxLimit}`,
        Selesai: r.doneCount,
        'On Progress': r.checkedInCount + r.otwAssignedCount,
        'Menunggu QC': r.approvalPendingCount,
        'Revisi / Kendala': r.issueOrRevisionCount,
        'Avg Rx (dBm)': r.avgDbm !== null ? r.avgDbm.toFixed(1) : '-',
        'Foto Geotag Valid (%)': `${r.housePhotoPct}%`
      }));

      const wb = XLSX.utils.book_new();
      const wsWo = XLSX.utils.json_to_sheet(woRows);
      const wsTech = XLSX.utils.json_to_sheet(techRows);
      XLSX.utils.book_append_sheet(wb, wsWo, 'WO Hari Ini');
      XLSX.utils.book_append_sheet(wb, wsTech, 'Beban Teknisi');
      const safeSector = (displayArea || 'sektor').replace(/[^a-zA-Z0-9_-]+/g, '_');
      XLSX.writeFile(wb, `Rekap_Leader_${safeSector}_${todayWIB}.xlsx`);
      toast.success(`Rekap harian ${todayTickets.length} WO berhasil diekspor ke Excel.`, 'Ekspor Berhasil');
    } catch {
      toast.error('Gagal membuat file ekspor Excel.', 'Ekspor Gagal');
    }
  };

  const openQuickAssignModal = (opts?: { ticketId?: string; installerName?: string; mode?: 'manual' | 'auto' }) => {
    const defaultTicketId = opts?.ticketId || metrics.unassignedTickets[0]?.id || '';
    const firstAvailTech =
      technicianSummaries.find(s => !s.isFull)?.installer.name ||
      myInstallers[0]?.name ||
      '';
    setAssignModalMode(opts?.mode || 'manual');
    setModalTicketId(defaultTicketId);
    setModalInstallerName(opts?.installerName || firstAvailTech);
    const chosenT = todayTickets.find(t => t.id === defaultTicketId);
    setModalSlotTime(chosenT?.slotTime || '');
    setAssignModalOpen(true);
  };

  const handleConfirmManualAssign = async () => {
    if (currentUser.role !== 'leader') {
      toast.error('Hanya akun Leader yang dapat melakukan disposisi penugasan teknisi.', 'Akses Ditolak');
      return;
    }
    if (!modalTicketId || !modalInstallerName) {
      toast.error('Pilih Work Order dan Teknisi tujuan terlebih dahulu.', 'Validasi Gagal');
      return;
    }
    const targetTicket = todayTickets.find(t => t.id === modalTicketId);
    if (!targetTicket) return;

    const techSummary = technicianSummaries.find(
      s => s.installer.name.toLowerCase().trim() === modalInstallerName.toLowerCase().trim()
    );
    if (techSummary && quotaConfig.enforceStrictLimit && techSummary.isFull) {
      toast.error(
        `Kuota harian ${modalInstallerName} penuh (${techSummary.assignedCount}/${techSummary.maxLimit} WO).`,
        'Batas Kuota Tercapai'
      );
      return;
    }

    setIsSubmittingAssign(true);
    try {
      if (modalSlotTime && modalSlotTime !== targetTicket.slotTime) {
        bulkAssignPersonnel([targetTicket.id], currentUser.name, modalInstallerName, modalSlotTime);
      } else {
        assignTicketPersonnel(targetTicket.id, currentUser.name, modalInstallerName);
      }
      toast.success(
        `WO ${targetTicket.woNumber} berhasil didisposisikan ke ${modalInstallerName}.`,
        'Disposisi Berhasil'
      );
      setAssignModalOpen(false);
    } finally {
      setIsSubmittingAssign(false);
    }
  };

  const handleExecuteAutoBalance = async () => {
    if (currentUser.role !== 'leader') {
      toast.error('Hanya akun Leader yang dapat menjalankan Auto-Balance.', 'Akses Ditolak');
      return;
    }
    if (autoBalancePlan.planned.length === 0) {
      toast.warning('Tidak ada pasangan WO & teknisi tersedia untuk Auto-Balance.', 'Tidak Ada Rencana');
      return;
    }
    setIsSubmittingAssign(true);
    try {
      autoBalancePlan.planned.forEach(item => {
        assignTicketPersonnel(item.ticket.id, currentUser.name, item.installer.name);
      });
      toast.success(
        `${autoBalancePlan.planned.length} Work Order berhasil didistribusikan otomatis ke tim teknisi.`,
        'Auto-Balance Sukses'
      );
      setAssignModalOpen(false);
    } finally {
      setIsSubmittingAssign(false);
    }
  };

  const handleContactInstaller = (installer: User, sampleTicket?: Ticket) => {
    if (sampleTicket && onOpenWhatsApp) {
      onOpenWhatsApp(sampleTicket);
      return;
    }
    if (installer.phone && isValidPhoneNumber(installer.phone)) {
      const msg = `Halo rekan ${installer.name}, mohon update kendala/progres Work Order di sektor ${displayArea}.`;
      const waRes = buildWhatsAppClickToChatUrl(installer.phone, msg);
      if (waRes.url) {
        const link = document.createElement('a');
        link.href = waRes.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.click();
        return;
      }
    }
    toast.info(`Nomor WhatsApp ${installer.name}: ${installer.phone || 'belum terdaftar'}`, 'Info Kontak');
  };

  const gradeInfo = useMemo(() => {
    const pct = metrics.slaPct;
    if (metrics.total === 0) {
      return { grade: 'STANDBY', cls: 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#35105E] dark:text-[#dab9ff]' };
    }
    if (pct >= 95) return { grade: 'GRADE A+', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300' };
    if (pct >= 85) return { grade: 'GRADE A', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300' };
    if (pct >= 70) return { grade: 'GRADE B', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300' };
    return { grade: 'GRADE C', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300' };
  }, [metrics.slaPct, metrics.total]);

  const lastSyncDisplay = useMemo(() => {
    if (!lastSyncTime) return 'LIVE CLOUD';
    return `SYNC: ${formatJakartaTimeOnly(lastSyncTime)}`;
  }, [lastSyncTime]);

  const topTechRows = richTechRows.slice(0, 5);
  const compactTechRows = richTechRows.slice(5);

  const sectorSubAreaSummaryText = useMemo(() => {
    if (subAreaBreakdown.length === 0) return `Sektor ${displayArea}`;
    return subAreaBreakdown
      .slice(0, 3)
      .map(s => `${s.name} (${s.total})`)
      .join(', ');
  }, [subAreaBreakdown, displayArea]);

  return (
    <div className="flex flex-col w-full space-y-4 pb-6">
      {/* ==================================================================== */}
      {/* 1. LEADER COMMAND HUB HEADER SUB-BAR & SCOPE BANNER                  */}
      {/* ==================================================================== */}
      <section className="w-full bg-white dark:bg-[#1A0E2E] rounded-2xl p-4 sm:p-5 shadow-[0_4px_20px_-4px_rgba(38,54,74,0.06)] dark:shadow-[0_1px_3px_rgba(33,24,58,0.05),0_8px_18px_-4px_rgba(53,16,94,0.07)] border border-[#DDE6F0] dark:border-[#35105E]">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-[#DDF4F4] dark:bg-[#2B174D] flex items-center justify-center text-[#2E7D8B] dark:text-[#dab9ff] shadow-[inset_0_1px_2px_rgba(255,255,255,0.9),0_2px_6px_rgba(46,125,139,0.12)] shrink-0">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10.5px] uppercase font-extrabold tracking-wider px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#dab9ff]">
                  LEADER COMMAND HUB
                </span>
                <span className="text-xs text-[#52647A] dark:text-[#CEC0E8] flex items-center gap-1.5 font-medium">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      databaseStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                    }`}
                  />
                  {databaseStatus === 'connected' ? 'Live Geofence Telemetry' : 'Offline Sync Mode'}
                </span>
                <span className="text-[11px] font-mono text-[#8492A5] dark:text-[#A78BFA] hidden sm:inline">
                  · {formatAppointmentDateDisplay(todayWIB)}
                </span>
              </div>
              <h1
                className="text-base sm:text-lg font-extrabold text-[#26364A] dark:text-white tracking-tight mt-0.5 truncate"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                Vendor {displayContractor} • Sektor {displayArea}
                {metrics.clusterNames.length > 0 && ` (${metrics.clusterNames.slice(0, 3).join(', ')})`}
              </h1>
            </div>
          </div>

          {/* 3D Tactile Quick Actions */}
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <button
              type="button"
              onClick={() => openQuickAssignModal({ mode: metrics.unassignedTickets.length > 1 ? 'auto' : 'manual' })}
              className="mj-btn-leader-primary px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Disposisi Instan WO</span>
              <span className="ml-0.5 px-1.5 py-0.5 bg-white/20 rounded-full text-[10.5px] font-mono tabular-nums">
                {metrics.unassignedTickets.length} New
              </span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('monitoring_maps')}
              className="mj-btn-leader-neutral px-3.5 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <MapIcon className="w-4 h-4 text-[#5145A6] dark:text-[#dab9ff]" />
              <span>Buka Monitoring Maps</span>
            </button>

            <button
              type="button"
              onClick={handleExportDailyRecap}
              className="mj-btn-leader-neutral px-3.5 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <ExternalLink className="w-4 h-4 text-[#5145A6] dark:text-[#dab9ff]" />
              <span>Ekspor Rekap Harian</span>
            </button>
          </div>
        </div>

        {/* Sub-bar Operational Notice Tag */}
        <div className="mt-3.5 pt-3 border-t border-[#DDE6F0] dark:border-[#35105E]/80 flex flex-wrap items-center justify-between text-xs text-[#52647A] dark:text-[#CEC0E8] gap-2">
          <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
            <span className="flex items-center gap-1.5">
              <Users2 className="w-4 h-4 text-[#5145A6] dark:text-[#dab9ff]" />
              <strong className="text-[#26364A] dark:text-white tabular-nums">
                {myInstallers.length} Teknisi Bertugas
              </strong>
              <span className="text-[11px] text-[#8492A5] dark:text-[#A78BFA]">
                ({metrics.houseValidCount} Check-In Foto Valid)
              </span>
            </span>

            <span className="text-[#CBD5E1] dark:text-[#5B35B1] hidden sm:inline">•</span>

            <span className="flex items-center gap-1.5">
              <PieChart className="w-4 h-4 text-[#2E7D8B] dark:text-[#A78BFA]" />
              <span>
                Kuota Sektor:{' '}
                <strong className="text-[#26364A] dark:text-white tabular-nums">
                  {metrics.assignedCount} / {metrics.totalDailyCapacity} WO
                </strong>
              </span>
              <span className="px-1.5 py-0.5 text-[10.5px] rounded bg-[#DDF4F4] dark:bg-[#35105E] text-[#2E7D8B] dark:text-[#dab9ff] font-bold tabular-nums">
                {metrics.capacityFillPct}% Terisi
              </span>
            </span>

            <span className="text-[#CBD5E1] dark:text-[#5B35B1] hidden sm:inline">•</span>

            <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>RBAC Leader {displayArea} Active</span>
            </span>
          </div>

          <button
            type="button"
            onClick={handleManualSync}
            disabled={isRefreshingNow}
            className="font-mono text-[11px] text-[#52647A] dark:text-[#A78BFA] hover:text-[#5145A6] dark:hover:text-white flex items-center gap-1.5 cursor-pointer"
            title="Sinkronkan ulang data telemetri"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                syncStatus === 'SAVED' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
              }`}
            />
            <span>{isRefreshingNow ? 'MENYINKRONKAN...' : lastSyncDisplay}</span>
            <RefreshCw className={`w-3 h-3 ${isRefreshingNow ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* 2. PRIMARY 3D FLOATING KPI GRID (6 Tactile Cards)                    */}
      {/* ==================================================================== */}
      <section className={`grid gap-3 ${isCompactUI ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6'}`}>
        {/* Card 1: TOTAL MASUK */}
        <div
          onClick={() => navigateWithDrilldown('total_today', 'all')}
          className="bg-white dark:bg-[#1A0E2E] rounded-2xl p-3.5 shadow-[0_2px_10px_rgba(38,54,74,0.05),inset_0_1px_0_rgba(255,255,255,0.95)] hover:shadow-[0_6px_16px_rgba(81,69,166,0.12)] transition-all duration-200 flex flex-col justify-between border border-[#DDE6F0] dark:border-[#35105E] border-b-2 border-b-[#9E94E2] dark:border-b-[#d0bcff] cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] uppercase font-bold text-[#52647A] dark:text-[#CEC0E8] tracking-wider">
              Total Masuk
            </span>
            <Inbox className="w-4 h-4 text-[#5145A6] dark:text-[#dab9ff]" />
          </div>
          <div className="my-2">
            <div
              className="text-2xl font-extrabold text-[#26364A] dark:text-white leading-none tracking-tight tabular-nums"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              {String(metrics.total).padStart(2, '0')}{' '}
              <span className="text-xs font-medium text-[#8492A5] dark:text-[#A78BFA]">WO</span>
            </div>
            <div className="text-[11px] text-emerald-700 dark:text-emerald-300 flex items-center gap-1 mt-1.5">
              <TrendingUp className="w-3.5 h-3.5 shrink-0" />
              <span>Kapasitas Sektor: {metrics.totalDailyCapacity} WO</span>
            </div>
          </div>
          <div className="w-full bg-[#EAE8FF] dark:bg-[#2A1650] rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-[#6657C8] dark:bg-[#A78BFA] h-1.5 rounded-full transition-all"
              style={{
                width: `${
                  metrics.totalDailyCapacity > 0
                    ? Math.min(100, Math.round((metrics.total / metrics.totalDailyCapacity) * 100))
                    : 0
                }%`
              }}
            />
          </div>
        </div>

        {/* Card 2: UNASSIGNED */}
        <div
          className={`bg-white dark:bg-[#1A0E2E] rounded-2xl p-3.5 transition-all duration-200 flex flex-col justify-between border relative overflow-hidden ${
            metrics.unassignedTickets.length > 0
              ? 'border-amber-200 dark:border-amber-700/60 border-b-2 border-b-amber-400 shadow-[0_2px_10px_rgba(245,158,11,0.12)]'
              : 'border-[#DDE6F0] dark:border-[#35105E] border-b-2 border-b-emerald-400 shadow-[0_2px_10px_rgba(38,54,74,0.05)]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] uppercase font-bold text-amber-800 dark:text-amber-300 tracking-wider">
              Unassigned
            </span>
            {metrics.unassignedTickets.length > 0 ? (
              <span className="px-1.5 py-0.5 rounded text-[9.5px] font-extrabold bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-200 border border-amber-300/60 animate-pulse">
                KRITIS
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded text-[9.5px] font-extrabold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300">
                TERDISPOSISI
              </span>
            )}
          </div>
          <div className="my-2">
            <div
              className={`text-2xl font-extrabold leading-none tracking-tight tabular-nums ${
                metrics.unassignedTickets.length > 0
                  ? 'text-amber-600 dark:text-amber-300'
                  : 'text-emerald-600 dark:text-emerald-300'
              }`}
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              {String(metrics.unassignedTickets.length).padStart(2, '0')}{' '}
              <span className="text-xs font-medium text-[#8492A5] dark:text-[#CEC0E8]">WO</span>
            </div>
            <div className="text-[11px] text-amber-900 dark:text-amber-200/90 font-medium flex items-center gap-1 mt-1.5">
              <Clock className="w-3 h-3 text-amber-600 shrink-0" />
              <span>
                {metrics.unassignedTickets.length > 0
                  ? `Antre terlama: ${metrics.oldestUnassignedWait}`
                  : 'Semua WO telah ditugaskan'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              metrics.unassignedTickets.length > 0
                ? openQuickAssignModal({ mode: 'manual' })
                : navigateWithDrilldown('assigned', 'assigned')
            }
            className={`w-full py-1.5 text-[11px] text-center cursor-pointer ${
              metrics.unassignedTickets.length > 0
                ? 'mj-btn-leader-warning mj-btn-xs'
                : 'mj-btn-leader-success mj-btn-xs'
            }`}
          >
            {metrics.unassignedTickets.length > 0 ? 'Assign Sekarang' : 'Lihat Penugasan'}
          </button>
        </div>

        {/* Card 3: PROGRESS LAPANGAN */}
        <div
          onClick={() => navigateWithDrilldown('checked_in_progress', 'in_progress')}
          className="bg-white dark:bg-[#1A0E2E] rounded-2xl p-3.5 shadow-[0_2px_10px_rgba(38,54,74,0.05)] hover:shadow-[0_6px_16px_rgba(46,125,139,0.12)] transition-all duration-200 flex flex-col justify-between border border-[#DDE6F0] dark:border-[#35105E] border-b-2 border-b-[#5BB5C5] dark:border-b-[#a380fe] cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] uppercase font-bold text-[#52647A] dark:text-[#CEC0E8] tracking-wider">
              Progress Lapangan
            </span>
            <span className="w-2.5 h-2.5 rounded-full bg-[#2E7D8B] dark:bg-[#7135B5] ring-4 ring-[#DDF4F4] dark:ring-[#35105E]" />
          </div>
          <div className="my-2">
            <div
              className="text-2xl font-extrabold text-[#26364A] dark:text-white leading-none tracking-tight tabular-nums"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              {String(metrics.progressLapanganTotal).padStart(2, '0')}{' '}
              <span className="text-xs font-medium text-[#8492A5] dark:text-[#A78BFA]">WO</span>
            </div>
            <div className="text-[11px] text-[#2E7D8B] dark:text-[#dab9ff] flex items-center gap-1 mt-1.5 truncate">
              <strong className="text-[#2E7D8B] dark:text-[#dab9ff]">{metrics.checkedInProgress} Check-In</strong>
              <span className="text-[#8492A5] dark:text-[#CEC0E8]">• {metrics.otwAssigned} Assigned/OTW</span>
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
            <span>Foto Rumah Valid: {metrics.houseGeotagPct}%</span>
            <Camera className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          </div>
        </div>

        {/* Card 4: VERIFIKASI NOC */}
        <div
          onClick={() => navigateWithDrilldown('butuh_approval', 'all')}
          className="bg-white dark:bg-[#1A0E2E] rounded-2xl p-3.5 shadow-[0_2px_10px_rgba(38,54,74,0.05)] hover:shadow-[0_6px_16px_rgba(81,69,166,0.12)] transition-all duration-200 flex flex-col justify-between border border-[#DDE6F0] dark:border-[#35105E] border-b-2 border-b-[#9E94E2] dark:border-b-[#a380fe] cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] uppercase font-bold text-[#52647A] dark:text-[#CEC0E8] tracking-wider">
              Verifikasi NOC
            </span>
            <ClipboardCheck className="w-4 h-4 text-[#5145A6] dark:text-[#A78BFA]" />
          </div>
          <div className="my-2">
            <div
              className="text-2xl font-extrabold text-[#5145A6] dark:text-[#dab9ff] leading-none tracking-tight tabular-nums"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              {String(metrics.butuhApproval).padStart(2, '0')}{' '}
              <span className="text-xs font-medium text-[#8492A5] dark:text-[#A78BFA]">WO</span>
            </div>
            <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] mt-1.5">
              QC OPM &amp; Redaman Dispatch
            </div>
          </div>
          <div className="w-full bg-[#EAE8FF] dark:bg-[#2A1650] rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-[#6657C8] dark:bg-[#A78BFA] h-1.5 rounded-full transition-all"
              style={{
                width: `${metrics.total > 0 ? Math.min(100, Math.round((metrics.butuhApproval / metrics.total) * 100)) : 0}%`
              }}
            />
          </div>
        </div>

        {/* Card 5: COMPLETE */}
        <div
          onClick={() => navigateWithDrilldown('approved', 'completed')}
          className="bg-white dark:bg-[#1A0E2E] rounded-2xl p-3.5 shadow-[0_2px_10px_rgba(16,185,129,0.08)] hover:shadow-[0_6px_14px_rgba(16,185,129,0.16)] transition-all duration-200 flex flex-col justify-between border border-[#DDE6F0] dark:border-[#35105E] border-b-2 border-b-emerald-400 cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] uppercase font-bold text-emerald-800 dark:text-emerald-300 tracking-wider">
              Complete
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="my-2">
            <div
              className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300 leading-none tracking-tight tabular-nums"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              {String(metrics.complete).padStart(2, '0')}{' '}
              <span className="text-xs font-medium text-emerald-800/70 dark:text-emerald-200/80">WO</span>
            </div>
            <div className="text-[11px] text-emerald-800 dark:text-emerald-200 flex items-center justify-between mt-1.5 tabular-nums">
              <span>
                SLA: <strong>{metrics.slaPct}%</strong>
              </span>
              <span>
                Avg: <strong>{metrics.avgDurationLabel}</strong>
              </span>
            </div>
          </div>
          <div className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>Terverifikasi / Selesai</span>
          </div>
        </div>

        {/* Card 6: KENDALA / REVISI */}
        <div
          onClick={() => navigateWithDrilldown('revision_rejected', 'pending')}
          className="bg-white dark:bg-[#1A0E2E] rounded-2xl p-3.5 shadow-[0_2px_8px_rgba(239,68,68,0.08)] hover:shadow-[0_6px_14px_rgba(239,68,68,0.14)] transition-all duration-200 flex flex-col justify-between border border-[#DDE6F0] dark:border-[#35105E] border-b-2 border-b-rose-400 cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] uppercase font-bold text-rose-800 dark:text-rose-300 tracking-wider">
              Kendala / Revisi
            </span>
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
          </div>
          <div className="my-2">
            <div
              className="text-2xl font-extrabold text-rose-600 dark:text-rose-300 leading-none tracking-tight tabular-nums"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              {String(metrics.kendalaRevisiTotal).padStart(2, '0')}{' '}
              <span className="text-xs font-medium text-[#8492A5] dark:text-[#CEC0E8]">WO</span>
            </div>
            <div className="text-[11px] flex flex-col gap-0.5 mt-1.5">
              <span className="text-amber-700 dark:text-amber-300 font-semibold">
                {metrics.revisionCount} Revisi QC
              </span>
              <span className="text-rose-700 dark:text-rose-300 font-semibold">
                {metrics.pendingTechnicalCount} Pending / Batal
              </span>
            </div>
          </div>
          <div className="w-full bg-rose-100 dark:bg-rose-950/60 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-rose-600 h-1.5 rounded-full transition-all"
              style={{
                width: `${
                  metrics.total > 0 ? Math.min(100, Math.round((metrics.kendalaRevisiTotal / metrics.total) * 100)) : 0
                }%`
              }}
            />
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* 3. SECONDARY METRIC STRIP (Capacity, Balance, Geotag, Splicing FTR)  */}
      {/* ==================================================================== */}
      <section className="w-full bg-[#EDF3F8] dark:bg-[#22123F] rounded-2xl p-2.5 shadow-[inset_0_1px_2px_rgba(38,54,74,0.04)] border border-[#DDE6F0] dark:border-[#35105E]">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="flex items-center gap-3 px-3 py-2 bg-white dark:bg-[#1A0E2E] rounded-xl shadow-xs">
            <div className="w-8 h-8 rounded-full bg-[#EAE8FF] dark:bg-[#35105E] flex items-center justify-center text-[#5145A6] dark:text-[#dab9ff] shrink-0">
              <Users2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-[#8492A5] dark:text-[#A78BFA] uppercase font-bold tracking-wider">
                Kapasitas Armada
              </div>
              <div className="text-xs sm:text-sm text-[#26364A] dark:text-white font-bold tabular-nums truncate">
                {myInstallers.length}/{allScopedInstallersIncludingInactive.length || myInstallers.length} Teknisi Aktif{' '}
                <span className="text-emerald-600 dark:text-emerald-300 text-[11px] font-semibold">
                  ({metrics.availableTechsCount} Siap Slot)
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 px-3 py-2 bg-white dark:bg-[#1A0E2E] rounded-xl shadow-xs">
            <div className="w-8 h-8 rounded-full bg-[#DDF4F4] dark:bg-[#35105E] flex items-center justify-center text-[#2E7D8B] dark:text-[#dab9ff] shrink-0">
              <Scale className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-[#8492A5] dark:text-[#A78BFA] uppercase font-bold tracking-wider">
                Rata-rata Beban
              </div>
              <div className="text-xs sm:text-sm text-[#26364A] dark:text-white font-bold tabular-nums truncate">
                {metrics.avgLoadPerTech} WO / Teknisi{' '}
                <span className="text-[#8492A5] dark:text-[#CEC0E8] text-[11px] font-normal">
                  (Maks {quotaConfig.defaultMaxDailyQuota}.0)
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 px-3 py-2 bg-white dark:bg-[#1A0E2E] rounded-xl shadow-xs">
            <div className="w-8 h-8 rounded-full bg-[#EAE8FF] dark:bg-[#35105E] flex items-center justify-center text-[#5145A6] dark:text-[#dab9ff] shrink-0">
              <Camera className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-[#8492A5] dark:text-[#A78BFA] uppercase font-bold tracking-wider">
                Geotag Photo Rate
              </div>
              <div className="text-xs sm:text-sm text-[#5145A6] dark:text-[#dab9ff] font-bold tabular-nums truncate">
                {metrics.houseGeotagPct}% Valid{' '}
                <span className="text-emerald-700 dark:text-emerald-300 text-[11px] font-medium">
                  ({metrics.houseValidCount}/{metrics.houseEligibleCount} Rumah)
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 px-3 py-2 bg-white dark:bg-[#1A0E2E] rounded-xl shadow-xs">
            <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-800 dark:text-emerald-300 shrink-0">
              <Wrench className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-[#8492A5] dark:text-[#A78BFA] uppercase font-bold tracking-wider">
                Splicing 1st-Time Right
              </div>
              <div className="text-xs sm:text-sm text-emerald-700 dark:text-emerald-300 font-bold tabular-nums truncate">
                {metrics.ftrRatePct}%{' '}
                <span className="text-[#8492A5] dark:text-[#CEC0E8] text-[11px] font-normal">
                  ({metrics.avgRxLabel !== '-' ? `${metrics.avgRxLabel} avg` : 'OPM Standby'})
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* 3B. SLOT APPOINTMENT & DISTRIBUSI JADWAL (PAGI / SIANG / SORE)       */}
      {/* ==================================================================== */}
      <section className="w-full bg-white dark:bg-[#1A0E2E] rounded-2xl p-4 sm:p-5 shadow-[0_4px_20px_-4px_rgba(38,54,74,0.06)] dark:shadow-[0_1px_3px_rgba(33,24,58,0.04),0_8px_16px_-4px_rgba(53,16,94,0.06)] border border-[#DDE6F0] dark:border-[#35105E]">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
          <div>
            <h2
              className="text-sm sm:text-base text-[#26364A] dark:text-white font-extrabold tracking-tight"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Slot Appointment &amp; Distribusi Jadwal
            </h2>
            <p className="text-xs text-[#52647A] dark:text-[#CEC0E8]">
              Monitoring load slot pelanggan per shift lapangan hari ini ({todayTickets.length} WO terdaftar).
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#DDF4F4] dark:bg-[#2B174D] border border-[#BDE4E8] dark:border-[#5B35B1] text-[10.5px] font-mono font-bold text-[#2E7D8B] dark:text-[#dab9ff]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2E7D8B] dark:bg-[#7135B5]" />
            TIMEZONE: WIB (GMT+7)
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {slotScheduleBreakdown.map(slot => (
            <button
              key={slot.key}
              type="button"
              onClick={() => {
                if (slot.unassigned > 0) {
                  openQuickAssignModal({ mode: 'manual' });
                } else if (onSwitchLeaderTab) {
                  onSwitchLeaderTab('wo_assignment', 'all');
                } else {
                  onNavigate('wo_assignment');
                }
              }}
              className="text-left p-3.5 rounded-2xl bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#3E246F] hover:border-[#6657C8] dark:hover:border-[#7135B5] transition-all cursor-pointer space-y-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#26364A] dark:text-white">
                    <Clock className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#dab9ff]" />
                    <span>{slot.title}</span>
                  </div>
                  <div className="text-[10.5px] font-mono text-[#8492A5] dark:text-[#A78BFA] mt-0.5">
                    {slot.windowLabel}
                  </div>
                </div>
                <span className="text-base font-extrabold font-mono text-[#26364A] dark:text-white tabular-nums">
                  {slot.total} <span className="text-[11px] font-semibold text-[#8492A5]">WO</span>
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] font-bold">
                {slot.unassigned > 0 ? (
                  <span className="text-[#BA1A1A] dark:text-rose-300">
                    • {slot.unassigned} Belum Assign
                  </span>
                ) : (
                  <span className="text-[#5145A6] dark:text-[#dab9ff]">
                    Progress Eksekusi
                  </span>
                )}
                <span className="font-mono text-[#26364A] dark:text-white tabular-nums">
                  {slot.progressPct}% Terjadwal
                </span>
              </div>

              <div className="w-full h-2 rounded-full bg-[#E4ECF5] dark:bg-[#2A1650] overflow-hidden flex">
                {slot.donePct > 0 && (
                  <div className="bg-emerald-500 h-full transition-all" style={{ width: `${slot.donePct}%` }} />
                )}
                {slot.runPct > 0 && (
                  <div className="bg-[#6657C8] dark:bg-[#7135B5] h-full transition-all" style={{ width: `${slot.runPct}%` }} />
                )}
              </div>

              <div className="flex items-center justify-between text-[10.5px] font-semibold tabular-nums pt-0.5">
                <span className="text-[#5145A6] dark:text-[#dab9ff]">● {slot.inProgress} Berjalan</span>
                <span className="text-emerald-700 dark:text-emerald-300">● {slot.done} Selesai</span>
                <span className={slot.unassigned > 0 ? 'text-[#BA1A1A] dark:text-rose-300' : 'text-[#8492A5] dark:text-[#A78BFA]'}>
                  ● {slot.unassigned} Unassigned
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ==================================================================== */}
      {/* 4. TWO-COLUMN OPERATIONAL CORE WORKSPACE (7 Col Left / 5 Col Right)  */}
      {/* ==================================================================== */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* LEFT COLUMN (col-span-7) */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          {/* a. Workload & Assignment Distribution Matrix */}
          <div className="bg-white dark:bg-[#1A0E2E] rounded-2xl p-4 sm:p-5 shadow-[0_4px_20px_-4px_rgba(38,54,74,0.06)] dark:shadow-[0_1px_3px_rgba(33,24,58,0.04),0_8px_16px_-4px_rgba(53,16,94,0.06)] border border-[#DDE6F0] dark:border-[#35105E]">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#DDE6F0] dark:border-[#35105E] mb-3.5">
              <div>
                <h2
                  className="text-sm sm:text-base text-[#26364A] dark:text-white font-extrabold tracking-tight"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                >
                  Distribusi Beban Kerja Teknisi ({myInstallers.length} Personil)
                </h2>
                <p className="text-xs text-[#52647A] dark:text-[#CEC0E8]">
                  Monitoring utilisasi kuota pengerjaan dan status live di Sektor {displayArea}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => (onSwitchLeaderTab ? onSwitchLeaderTab('installer_mgmt') : onNavigate('installer_mgmt'))}
                className="mj-btn-leader-neutral mj-btn-xs px-3 py-1 rounded-full text-[11px] cursor-pointer"
              >
                Kelola Tim ({myInstallers.length})
              </button>
            </div>

            {richTechRows.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#52647A] dark:text-[#CEC0E8] space-y-2">
                <Users2 className="w-8 h-8 mx-auto opacity-50 text-[#6657C8]" />
                <div className="font-semibold text-[#26364A] dark:text-white">
                  Belum ada teknisi aktif terdaftar untuk {displayContractor}
                </div>
                <button
                  type="button"
                  onClick={() => (onSwitchLeaderTab ? onSwitchLeaderTab('installer_mgmt') : onNavigate('installer_mgmt'))}
                  className="mj-btn-leader-primary mj-btn-compact px-3.5 py-1.5 text-xs cursor-pointer"
                >
                  + Tambah Akun Teknisi
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {topTechRows.map(row => {
                  const { summary, doneCount, checkedInCount, otwAssignedCount, issueOrRevisionCount, issueNote, avgDbm, housePhotoPct } = row;
                  const inst = summary.installer;
                  const hasIssue = issueOrRevisionCount > 0;
                  const isFull = summary.isFull;
                  const cardBorderCls = hasIssue
                    ? 'border border-amber-300 dark:border-amber-700/70'
                    : isFull
                    ? 'border border-[#C5BEEF] dark:border-[#5B35B1]'
                    : 'border border-[#DDE6F0] dark:border-[#35105E]';

                  const barColor = hasIssue
                    ? 'bg-amber-500'
                    : isFull
                    ? 'bg-[#5145A6]'
                    : summary.liveTone === 'onsite'
                    ? 'bg-emerald-500'
                    : summary.liveTone === 'enroute'
                    ? 'bg-[#2E7D8B]'
                    : 'bg-[#6657C8]';

                  const statusPill = hasIssue
                    ? {
                        label: `Butuh Bantuan Leader (${summary.assignedCount}/${summary.maxLimit})`,
                        cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200'
                      }
                    : isFull
                    ? {
                        label: `Kapasitas Penuh (${summary.assignedCount}/${summary.maxLimit})`,
                        cls: 'bg-[#EAE8FF] text-[#5145A6] dark:bg-purple-950/70 dark:text-purple-200'
                      }
                    : summary.liveTone === 'onsite'
                    ? {
                        label: `Lokasi Pelanggan (${summary.assignedCount}/${summary.maxLimit})`,
                        cls: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-200'
                      }
                    : summary.liveTone === 'enroute'
                    ? {
                        label: `On Field (${summary.assignedCount}/${summary.maxLimit})`,
                        cls: 'bg-[#DDF4F4] text-[#2E7D8B] dark:bg-[#35105E] dark:text-[#dab9ff]'
                      }
                    : {
                        label: `Tersedia (${summary.assignedCount}/${summary.maxLimit})`,
                        cls: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-200'
                      };

                  return (
                    <div
                      key={inst.id}
                      className={`p-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#22123F] hover:bg-[#EDF3F8] dark:hover:bg-[#2A1650] transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${cardBorderCls}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-[#EAE8FF] dark:bg-[#35105E] flex items-center justify-center font-extrabold text-[#5145A6] dark:text-[#dab9ff] text-xs shadow-inner shrink-0">
                          {getInitials(inst.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm text-[#26364A] dark:text-white font-bold truncate">
                              {inst.name}
                            </span>
                            <span className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-[#E4ECF5] dark:bg-[#35105E] text-[#52647A] dark:text-[#CEC0E8] font-semibold">
                              @{inst.username}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusPill.cls}`}>
                              {statusPill.label}
                            </span>
                          </div>
                          <div className="text-[11.5px] text-[#52647A] dark:text-[#CEC0E8] mt-0.5 flex items-center gap-1.5 flex-wrap">
                            <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
                              {doneCount} Selesai
                            </span>
                            {checkedInCount + otwAssignedCount > 0 && (
                              <>
                                <span>•</span>
                                <span className="text-[#5145A6] dark:text-[#dab9ff] font-medium">
                                  {checkedInCount > 0
                                    ? `${checkedInCount} On Progress (${summary.liveLocationLabel})`
                                    : `${otwAssignedCount} Terjadwal`}
                                </span>
                              </>
                            )}
                            {hasIssue && (
                              <>
                                <span>•</span>
                                <span className="text-amber-700 dark:text-amber-300 font-bold truncate max-w-[240px]">
                                  {issueOrRevisionCount} Kendala{issueNote ? ` (${issueNote})` : ''}
                                </span>
                              </>
                            )}
                            {!hasIssue && avgDbm !== null && (
                              <>
                                <span>•</span>
                                <span className="font-mono">Avg: {avgDbm.toFixed(1)} dBm</span>
                              </>
                            )}
                            {!hasIssue && avgDbm === null && (
                              <>
                                <span>•</span>
                                <span>Foto Rumah: {housePhotoPct}%</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 sm:self-center shrink-0">
                        <div className="w-24 bg-[#E4ECF5] dark:bg-[#35105E] rounded-full h-2 overflow-hidden">
                          <div
                            className={`${barColor} h-2 rounded-full transition-all`}
                            style={{ width: `${summary.utilizationPct}%` }}
                          />
                        </div>

                        {hasIssue ? (
                          <button
                            type="button"
                            onClick={() => handleContactInstaller(inst, row.activeTickets[0])}
                            className="mj-btn-leader-warning mj-btn-xs px-3 py-1.5 text-[11px] flex items-center gap-1 cursor-pointer"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            <span>Kontak</span>
                          </button>
                        ) : isFull && quotaConfig.enforceStrictLimit ? (
                          <button
                            type="button"
                            disabled
                            className="mj-btn-leader-neutral mj-btn-xs px-3 py-1.5 text-[11px]"
                          >
                            Maksimal
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              openQuickAssignModal({
                                mode: 'manual',
                                installerName: inst.name
                              })
                            }
                            className={`px-3 py-1.5 text-[11px] flex items-center gap-1 cursor-pointer ${
                              summary.assignedCount <= Math.floor(summary.maxLimit / 2)
                                ? 'mj-btn-leader-primary mj-btn-xs'
                                : 'mj-btn-leader-neutral mj-btn-xs text-[#5145A6] dark:text-[#dab9ff]'
                            }`}
                          >
                            <Send className="w-3 h-3" />
                            <span>{summary.assignedCount <= Math.floor(summary.maxLimit / 2) ? 'Assign WO' : '+ 1 Assign'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Compact grid for remaining technicians (> 5) */}
                {compactTechRows.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1">
                    {compactTechRows.map(row => {
                      const s = row.summary;
                      return (
                        <div
                          key={s.installer.id}
                          className={`p-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#22123F] border flex items-center justify-between gap-2 ${
                            s.isFull
                              ? 'border-emerald-300 dark:border-emerald-800'
                              : s.liveTone === 'enroute' || s.liveTone === 'onsite'
                              ? 'border-[#9E94E2] dark:border-[#5B35B1]'
                              : 'border-[#DDE6F0] dark:border-[#35105E]'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[#26364A] dark:text-white truncate">
                              {s.installer.name}
                            </div>
                            <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] truncate tabular-nums">
                              @{s.installer.username} • {s.assignedCount}/{s.maxLimit} WO ({s.liveStatusLabel})
                            </div>
                          </div>
                          {s.isFull ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          ) : s.liveTone === 'enroute' ? (
                            <Bike className="w-4 h-4 text-[#2E7D8B] dark:text-[#dab9ff] shrink-0" />
                          ) : (
                            <button
                              type="button"
                              onClick={() => openQuickAssignModal({ mode: 'manual', installerName: s.installer.name })}
                              className="mj-btn-leader-primary mj-btn-xs px-2.5 py-0.5 text-[10px] shrink-0 cursor-pointer"
                            >
                              Assign
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* b. Live Feed Tiket & Progres Pelanggan */}
          <div className="bg-white dark:bg-[#1A0E2E] rounded-2xl p-4 sm:p-5 shadow-[0_4px_20px_-4px_rgba(38,54,74,0.06)] dark:shadow-[0_1px_3px_rgba(33,24,58,0.04),0_8px_16px_-4px_rgba(53,16,94,0.06)] border border-[#DDE6F0] dark:border-[#35105E]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-[#DDE6F0] dark:border-[#35105E] mb-3">
              <div>
                <h2
                  className="text-sm sm:text-base text-[#26364A] dark:text-white font-extrabold tracking-tight"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                >
                  Live Feed Tiket &amp; Progres Pelanggan
                </h2>
                <p className="text-xs text-[#52647A] dark:text-[#CEC0E8]">
                  Work order aktif sektor {displayArea} ({todayTickets.length} WO hari ini).
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setAutoRefresh15s(prev => !prev)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition cursor-pointer ${
                    autoRefresh15s
                      ? 'bg-[#DDF4F4] dark:bg-[#2E1B59] border-[#BDE4E8] dark:border-[#7135B5] text-[#2E7D8B] dark:text-[#dab9ff]'
                      : 'bg-[#F4F7FB] dark:bg-[#22123F] border-[#DDE6F0] dark:border-[#35105E] text-[#52647A] dark:text-[#CEC0E8]'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      autoRefresh15s ? 'bg-[#2E7D8B] dark:bg-[#dab9ff] animate-pulse' : 'bg-[#8492A5]'
                    }`}
                  />
                  <span>Auto-Refresh 15s</span>
                </button>
              </div>
            </div>

            {/* Feed Filter Pills */}
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
              {(
                [
                  { id: 'all', label: `Semua (${todayTickets.length})` },
                  { id: 'checkin', label: `Check-In (${metrics.checkedInProgress})` },
                  { id: 'issue', label: `Kendala/Revisi (${metrics.kendalaRevisiTotal})` },
                  { id: 'complete', label: `Selesai (${metrics.complete})` }
                ] as const
              ).map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFeedFilter(tab.id)}
                  className={`px-3 py-1 rounded-full text-[11px] cursor-pointer ${
                    feedFilter === tab.id
                      ? 'mj-btn-leader-secondary mj-btn-xs'
                      : 'mj-btn-leader-neutral mj-btn-xs'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {liveFeedTickets.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#52647A] dark:text-[#CEC0E8]">
                Tidak ada Work Order pada kategori filter ini.
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-[#E2E8F0] dark:divide-[#35105E]/70">
                {liveFeedTickets.map(t => {
                  const approval = getTicketCanonicalApprovalStatus(t);
                  const rep = getTicketCanonicalReportStatus(t);
                  const closed = isTicketClosed(t);
                  const checkedIn = isTicketCheckedIn(t);
                  const assigned = isTicketAssigned(t);

                  let pill = {
                    label: 'ASSIGNED',
                    dot: 'bg-[#6657C8]',
                    cls: 'bg-[#EAE8FF] text-[#5145A6] border-[#C5BEEF] dark:bg-[#35105E] dark:text-[#dab9ff] dark:border-[#5B35B1]'
                  };

                  if (!assigned) {
                    pill = {
                      label: 'UNASSIGNED',
                      dot: 'bg-amber-500',
                      cls: 'bg-amber-50 text-amber-800 border-amber-300/60 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-700'
                    };
                  } else if (closed || approval === 'APPROVED' || t.statusWOInstaller === 'Completed') {
                    pill = {
                      label: 'COMPLETE (SELESAI)',
                      dot: 'bg-[#10b981]',
                      cls: 'bg-[#ecfdf5] text-[#065f46] border-[#10b981]/40 dark:bg-emerald-950/60 dark:text-emerald-300'
                    };
                  } else if (approval === 'REVISION') {
                    pill = {
                      label: 'REQUESTED (REVISI)',
                      dot: 'bg-[#f59e0b]',
                      cls: 'bg-[#fffbeb] text-[#92400e] border-[#f59e0b]/40 dark:bg-amber-950/60 dark:text-amber-300'
                    };
                  } else if (rep === 'RESCHEDULE') {
                    pill = {
                      label: 'RESCHEDULE',
                      dot: 'bg-[#6657C8]',
                      cls: 'bg-[#EAE8FF] text-[#5145A6] border-[#C5BEEF] dark:bg-purple-950/60 dark:text-purple-300'
                    };
                  } else if (t.statusWOInstaller === 'Pending Technical' || rep === 'PENDING') {
                    pill = {
                      label: 'PENDING LAPANGAN',
                      dot: 'bg-[#eab308]',
                      cls: 'bg-[#fefce8] text-[#854d0e] border-[#eab308]/40 dark:bg-amber-950/60 dark:text-amber-300'
                    };
                  } else if (approval === 'BUTUH APPROVAL') {
                    pill = {
                      label: 'MENUNGGU QC DISPATCH',
                      dot: 'bg-[#5145A6]',
                      cls: 'bg-[#EAE8FF] text-[#5145A6] border-[#C5BEEF] dark:bg-[#35105E] dark:text-[#dab9ff]'
                    };
                  } else if (checkedIn) {
                    pill = {
                      label: 'CHECK-IN VALID',
                      dot: 'bg-[#2E7D8B]',
                      cls: 'bg-[#DDF4F4] text-[#2E7D8B] border-[#BDE4E8] dark:bg-[#2E1B59] dark:text-[#dab9ff] dark:border-[#7135B5]'
                    };
                  }

                  const odpText = [t.fatCode || t.fat || t.fdtCode, t.fatPort ? `(Port ${t.fatPort})` : '']
                    .filter(Boolean)
                    .join(' ');
                  const addressText = [t.streetName || t.address, t.clusterName, t.area]
                    .filter(Boolean)
                    .join(', ');
                  const rxVal = t.rosetRedamanDbm ?? t.technicalReport?.opticalPowerDbm ?? t.technicalReport?.opticalPowerRx;
                  const accMeters = t.houseLocation?.accuracyMeters;
                  const timeWib = formatJakartaTimeOnly(t.checkInAt || t.updatedAt || t.createdAt);

                  return (
                    <div
                      key={t.id}
                      className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-2.5 hover:bg-[#F4F7FB] dark:hover:bg-[#22123F]/60 px-2 rounded-xl transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-extrabold text-[#5145A6] dark:text-[#dab9ff]">
                            {t.woNumber}
                          </span>
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border ${pill.cls}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${pill.dot}`} />
                            {pill.label}
                          </span>
                          {odpText && (
                            <span className="text-[11px] font-mono text-[#8492A5] dark:text-[#A78BFA]">
                              {odpText}
                            </span>
                          )}
                        </div>

                        <div className="text-xs sm:text-sm font-bold text-[#26364A] dark:text-white mt-1 truncate">
                          {t.customerName}{' '}
                          <span className="text-[#52647A] dark:text-[#CEC0E8] font-normal">
                            — {addressText || '-'}
                          </span>
                        </div>

                        <div className="text-[11.5px] text-[#52647A] dark:text-[#CEC0E8] flex items-center gap-2.5 mt-0.5 flex-wrap">
                          <span className="flex items-center gap-1">
                            <UserCheck className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#A78BFA]" />
                            {t.installerName || 'Belum Ditugaskan'}
                          </span>
                          {typeof accMeters === 'number' && (
                            <>
                              <span>•</span>
                              <span className="flex items-center gap-1 text-[#2E7D8B] dark:text-[#dab9ff] font-medium">
                                <Navigation className="w-3 h-3" />
                                GPS Lock ±{Math.round(accMeters)}m
                              </span>
                            </>
                          )}
                          {rxVal !== undefined && rxVal !== null && String(rxVal).trim() !== '' && (
                            <>
                              <span>•</span>
                              <span className="text-emerald-700 dark:text-emerald-300 font-mono font-semibold">
                                Roset: {rxVal} dBm
                              </span>
                            </>
                          )}
                          {(t.rejectionReason || t.remarksWOInstaller) && (
                            <>
                              <span>•</span>
                              <span className="text-amber-800 dark:text-amber-300 truncate max-w-[300px]">
                                {t.rejectionReason || t.remarksWOInstaller}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex md:flex-col items-center md:items-end justify-between gap-1.5 shrink-0">
                        <span className="font-mono text-[11px] text-[#8492A5] dark:text-[#A78BFA] tabular-nums">
                          {timeWib} WIB
                        </span>
                        <div className="flex items-center gap-1.5">
                          {!assigned && (
                            <button
                              type="button"
                              onClick={() => openQuickAssignModal({ ticketId: t.id, mode: 'manual' })}
                              className="mj-btn-leader-primary mj-btn-xs px-2.5 py-1 text-[11px] cursor-pointer"
                            >
                              Assign
                            </button>
                          )}
                          {onSelectTicket && (
                            <button
                              type="button"
                              onClick={() => onSelectTicket(t, checkedIn || approval !== 'NONE' ? 'report' : 'overview')}
                              className="mj-btn-leader-neutral mj-btn-xs px-2.5 py-1 text-[11px] flex items-center gap-1 cursor-pointer"
                            >
                              <Eye className="w-3 h-3" />
                              <span>{checkedIn || approval !== 'NONE' ? 'Lihat Bukti / WO' : 'Detail WO'}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN (col-span-5) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* 0. URGENT REASSIGNMENT ALERT CARD (Ref 1 Stitch Panel) */}
          {urgentReassignInfo.topTicket && (
            <div className="rounded-2xl p-4 sm:p-5 bg-[#FFF8F6] dark:bg-[#2A0E15] border border-[#FCA5A5] dark:border-[#93000A] shadow-[0_4px_14px_rgba(186,26,26,0.12)] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FFDAD6] dark:bg-[#93000A]/70 text-[#93000A] dark:text-rose-200 text-[10px] font-extrabold uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#BA1A1A] animate-pulse" />
                  REASSIGNMENT DIBUTUHKAN ({urgentReassignInfo.count})
                </span>
                <span className="text-[10.5px] font-extrabold font-mono text-[#BA1A1A] dark:text-rose-300">
                  SEGERA
                </span>
              </div>

              <div>
                <div
                  className="text-sm font-extrabold text-[#26364A] dark:text-white leading-snug"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                >
                  {urgentReassignInfo.topTicket.woNumber} •{' '}
                  {urgentReassignInfo.topTicket.clusterName || urgentReassignInfo.topTicket.area}
                </div>
                <p className="text-xs text-[#52647A] dark:text-[#F5D0D6] mt-1 line-clamp-2">
                  {urgentReassignInfo.topTicket.rejectionReason ||
                    urgentReassignInfo.topTicket.remarksWOInstaller ||
                    `Status ${urgentReassignInfo.topTicket.statusWOInstaller} pada teknisi ${urgentReassignInfo.topTicket.installerName}.`}
                </p>
              </div>

              <div className="p-2.5 rounded-xl bg-white dark:bg-[#1A0E2E] border border-[#FCA5A5]/60 dark:border-[#93000A]/60 grid grid-cols-2 gap-2 text-[11px]">
                <div className="min-w-0">
                  <span className="text-[10px] uppercase font-bold text-[#8492A5] dark:text-[#CEC0E8] block">
                    Teknisi Saat Ini
                  </span>
                  <strong className="text-[#93000A] dark:text-rose-300 truncate block">
                    {urgentReassignInfo.topTicket.installerName || '-'}
                  </strong>
                </div>
                <div className="min-w-0 text-right">
                  <span className="text-[10px] uppercase font-bold text-[#8492A5] dark:text-[#CEC0E8] block">
                    Rekomendasi Teknisi
                  </span>
                  <strong className="text-[#15803D] dark:text-emerald-300 truncate block">
                    {urgentReassignInfo.recommendedReplacement
                      ? `${urgentReassignInfo.recommendedReplacement.installer.name} (${urgentReassignInfo.recommendedReplacement.assignedCount}/${urgentReassignInfo.recommendedReplacement.maxLimit})`
                      : 'Cek Daftar Teknisi'}
                  </strong>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  onSwitchLeaderTab ? onSwitchLeaderTab('reassign_wo') : onNavigate('reassign_wo')
                }
                className="mj-btn-leader-danger w-full py-2.5 px-4 text-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <ArrowRightLeft className="w-4 h-4" />
                <span>Buka Reassign WO Sekarang</span>
              </button>
            </div>
          )}

          {/* a. Radar Geofence Sektor */}
          <div className="bg-white dark:bg-[#1A0E2E] rounded-2xl p-4 sm:p-5 shadow-[0_4px_20px_-4px_rgba(38,54,74,0.06)] dark:shadow-[0_1px_3px_rgba(33,24,58,0.04),0_8px_16px_-4px_rgba(53,16,94,0.06)] border border-[#DDE6F0] dark:border-[#35105E]">
            <div className="flex items-center justify-between pb-1.5 mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <MapPin className="w-4 h-4 text-[#5145A6] dark:text-[#dab9ff] shrink-0" />
                <h3
                  className="text-sm sm:text-base text-[#26364A] dark:text-white font-extrabold truncate"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                >
                  Radar Geofence {displayArea}
                </h3>
              </div>
              <span className="text-[10.5px] px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold shrink-0">
                GPS Live Stream
              </span>
            </div>
            <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] mb-3">
              Distribusi real-time {myInstallers.length} armada teknisi dan pin rumah check-in valid kamera di GIS.
            </p>

            <SectorGeofenceMiniRadar
              pins={radarPins}
              sectorLabel={displayArea}
              verifiedHouseCount={metrics.houseValidCount}
              subAreaSummaryText={sectorSubAreaSummaryText}
              avgDbmLabel={metrics.avgRxLabel}
            />

            <div className="mt-3">
              <button
                type="button"
                onClick={() => onNavigate('monitoring_maps')}
                className="mj-btn-leader-neutral w-full py-2.5 text-[#5145A6] dark:text-[#dab9ff] text-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <ArrowUpRight className="w-4 h-4" />
                <span>Perbesar ke Monitoring Maps &amp; Cluster ODP</span>
              </button>
            </div>
          </div>

          {/* b. Leader Attention: Unassigned Tickets Ready for Disposition */}
          <div className="bg-gradient-to-br from-white to-[#F4F7FB] dark:from-[#1A0E2E] dark:to-[#22123F] rounded-2xl p-4 sm:p-5 shadow-[0_4px_14px_rgba(245,158,11,0.12)] border border-amber-300/80 dark:border-amber-700/60">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-600 dark:text-amber-300 shrink-0">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm text-[#26364A] dark:text-white font-extrabold leading-tight">
                    Leader Attention: {metrics.unassignedTickets.length} WO Siap Disposisi
                  </h3>
                  <p className="text-xs text-amber-900 dark:text-amber-200/90 mt-0.5">
                    {metrics.unassignedTickets.length > 0
                      ? `Tiket masuk di Sektor ${displayArea} menunggu penugasan teknisi.`
                      : `Seluruh Work Order hari ini di Sektor ${displayArea} telah terdisposisi.`}
                  </p>
                </div>
              </div>
            </div>

            {metrics.unassignedTickets.length > 0 && (
              <div className="mt-3 space-y-2">
                {metrics.unassignedTickets.slice(0, 3).map(t => (
                  <div
                    key={t.id}
                    className="p-2.5 rounded-xl bg-white dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-[#26364A] dark:text-white truncate">
                        {t.woNumber} • {t.clusterName || t.streetName || t.area}
                      </div>
                      <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] truncate">
                        {[t.fatCode || t.fat || t.area, t.slotTime || 'Standar', `Antre ${formatWaitElapsed(t.importedAt || t.createdAt)}`].join(' • ')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openQuickAssignModal({ ticketId: t.id, mode: 'manual' })}
                      className="mj-btn-leader-primary mj-btn-xs px-2.5 py-1 text-[10.5px] shrink-0 cursor-pointer"
                    >
                      Disposisi
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() =>
                metrics.unassignedTickets.length > 0
                  ? openQuickAssignModal({ mode: 'auto' })
                  : onSwitchLeaderTab
                  ? onSwitchLeaderTab('wo_assignment', 'all')
                  : onNavigate('wo_assignment')
              }
              className="mj-btn-leader-primary mt-3 w-full py-2.5 text-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <Bolt className="w-4 h-4" />
              <span>
                {metrics.unassignedTickets.length > 0
                  ? `Buka Modal Auto/Manual Assign (${metrics.unassignedTickets.length} Tiket)`
                  : 'Buka Matriks Penugasan Assign WO'}
              </span>
            </button>
          </div>

          {/* c. Kuota Sub-Area Sektor */}
          <div className="bg-white dark:bg-[#1A0E2E] rounded-2xl p-4 sm:p-5 shadow-[0_4px_20px_-4px_rgba(38,54,74,0.06)] dark:shadow-[0_1px_3px_rgba(33,24,58,0.04),0_8px_16px_-4px_rgba(53,16,94,0.06)] border border-[#DDE6F0] dark:border-[#35105E]">
            <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-[#DDE6F0] dark:border-[#35105E]">
              <div>
                <h3
                  className="text-sm sm:text-base text-[#26364A] dark:text-white font-extrabold"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                >
                  Kuota Sub-Area {displayArea}
                </h3>
                <p className="text-xs text-[#52647A] dark:text-[#CEC0E8]">
                  Distribusi kapasitas harian berdasarkan cluster / sub-area aktif.
                </p>
              </div>
              <button
                type="button"
                onClick={() => (onSwitchLeaderTab ? onSwitchLeaderTab('wo_assignment', 'all') : onNavigate('wo_assignment'))}
                className="mj-btn-icon-3d-leader w-8 h-8 cursor-pointer shrink-0"
                title="Buka Assign WO"
              >
                <PieChart className="w-4 h-4" />
              </button>
            </div>

            {subAreaBreakdown.length === 0 ? (
              <div className="py-5 text-center text-xs text-[#8492A5] dark:text-[#CEC0E8]">
                Belum ada distribusi WO per cluster hari ini.
              </div>
            ) : (
              <div className="space-y-3.5">
                {subAreaBreakdown.map((area, idx) => {
                  const barCls =
                    idx === 0
                      ? 'from-[#6657C8] to-[#5145A6]'
                      : idx === 1
                      ? 'from-[#2E7D8B] to-[#5BB5C5]'
                      : 'from-emerald-500 to-emerald-400';
                  const textCls =
                    idx === 0
                      ? 'text-[#5145A6] dark:text-[#dab9ff]'
                      : idx === 1
                      ? 'text-[#2E7D8B] dark:text-[#A78BFA]'
                      : 'text-emerald-700 dark:text-emerald-300';

                  return (
                    <div key={area.name}>
                      <div className="flex justify-between items-baseline mb-1 gap-2">
                        <span className="text-xs sm:text-sm font-bold text-[#26364A] dark:text-white truncate">
                          {area.name}
                        </span>
                        <span className={`font-mono text-[11px] font-bold shrink-0 tabular-nums ${textCls}`}>
                          {area.assigned} / {area.capacity} WO{' '}
                          <span className="text-[#8492A5] dark:text-[#CEC0E8] font-normal">({area.pct}%)</span>
                        </span>
                      </div>
                      <div className="w-full bg-[#E4ECF5] dark:bg-[#2A1650] rounded-full h-2.5 overflow-hidden shadow-inner">
                        <div
                          className={`bg-gradient-to-r ${barCls} h-2.5 rounded-full transition-all duration-500`}
                          style={{ width: `${area.pct}%` }}
                        />
                      </div>
                      <div className="flex justify-between items-center text-[11px] text-[#52647A] dark:text-[#CEC0E8] mt-1">
                        <span>
                          Sisa Slot: <strong className="text-[#26364A] dark:text-white">{area.spare} WO</strong>
                          {area.unassigned > 0 ? ` (${area.unassigned} Unassigned)` : ''}
                        </span>
                        {area.issues > 0 ? (
                          <span className="text-amber-700 dark:text-amber-300 font-semibold">
                            {area.issues} Kendala / Revisi
                          </span>
                        ) : (
                          <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
                            {area.complete} Selesai
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Sector SLA Target Summary Box */}
            <div className="mt-4 p-3 rounded-xl bg-[#F4F7FB] dark:bg-[#22123F] flex items-center justify-between gap-2 border border-[#DDE6F0] dark:border-[#35105E]">
              <div className="flex items-center gap-2.5 min-w-0">
                <Sliders className="w-4 h-4 text-[#5145A6] dark:text-[#dab9ff] shrink-0" />
                <div className="text-xs min-w-0">
                  <div className="font-bold text-[#26364A] dark:text-white truncate">
                    Target Harian {displayContractor}
                  </div>
                  <div className="text-[#52647A] dark:text-[#CEC0E8] text-[11px] tabular-nums">
                    SLA Penyelesaian Saat Ini: {metrics.slaPct}% (Target &ge;95%)
                  </div>
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded text-[11px] font-extrabold font-mono shrink-0 ${gradeInfo.cls}`}>
                {gradeInfo.grade}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* 5. INSTANT DISPOSITION & AUTO-BALANCE MODAL                          */}
      {/* ==================================================================== */}
      <ResponsiveModal
        isOpen={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        title="Disposisi Instan Work Order"
        subtitle={`Sektor ${displayArea} • ${metrics.unassignedTickets.length} WO menunggu penugasan`}
        size="lg"
      >
        <div className="space-y-4">
          {/* Mode Tabs */}
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#EDF3F8] dark:bg-[#22123F] border border-[#DDE6F0] dark:border-[#35105E]">
            <button
              type="button"
              onClick={() => setAssignModalMode('manual')}
              className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                assignModalMode === 'manual'
                  ? 'bg-white dark:bg-[#35105E] text-[#5145A6] dark:text-white shadow-xs'
                  : 'text-[#52647A] dark:text-[#CEC0E8]'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Disposisi Manual</span>
            </button>
            <button
              type="button"
              onClick={() => setAssignModalMode('auto')}
              className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                assignModalMode === 'auto'
                  ? 'bg-white dark:bg-[#35105E] text-[#5145A6] dark:text-white shadow-xs'
                  : 'text-[#52647A] dark:text-[#CEC0E8]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Smart Auto-Balance ({autoBalancePlan.planned.length})</span>
            </button>
          </div>

          {assignModalMode === 'manual' ? (
            metrics.unassignedTickets.length === 0 ? (
              <div className="p-6 text-center rounded-xl bg-[#F4F7FB] dark:bg-[#22123F] text-xs text-[#52647A] dark:text-[#CEC0E8] space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                <div className="font-bold text-[#26364A] dark:text-white">
                  Semua Work Order Hari Ini Telah Di-assign
                </div>
                <p>Anda dapat mengelola Reassign atau melihat jadwal slot pada menu Assign WO.</p>
                <button
                  type="button"
                  onClick={() => {
                    setAssignModalOpen(false);
                    if (onSwitchLeaderTab) onSwitchLeaderTab('wo_assignment', 'all');
                    else onNavigate('wo_assignment');
                  }}
                  className="mj-btn-leader-primary mj-btn-compact px-4 py-2 text-xs cursor-pointer"
                >
                  Buka Matriks Assign WO
                </button>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-bold text-[#26364A] dark:text-white mb-1">
                    1. Pilih Work Order Unassigned ({metrics.unassignedTickets.length})
                  </label>
                  <select
                    value={modalTicketId}
                    onChange={e => {
                      const id = e.target.value;
                      setModalTicketId(id);
                      const found = todayTickets.find(t => t.id === id);
                      if (found) setModalSlotTime(found.slotTime || '');
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-[#F4F7FB] dark:bg-[#22123F] border border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-white font-medium"
                  >
                    {metrics.unassignedTickets.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.woNumber} — {t.customerName} ({t.clusterName || t.area} • {t.slotTime || 'Standar'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-[#26364A] dark:text-white mb-1">
                    2. Pilih Teknisi Pelaksana ({myInstallers.length} Aktif)
                  </label>
                  <select
                    value={modalInstallerName}
                    onChange={e => setModalInstallerName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#F4F7FB] dark:bg-[#22123F] border border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-white font-medium"
                  >
                    {technicianSummaries.map(s => (
                      <option key={s.installer.id} value={s.installer.name}>
                        {s.installer.name} ({s.assignedCount}/{s.maxLimit} WO • {s.liveStatusLabel})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-[#26364A] dark:text-white mb-1">
                    3. Slot Jadwal Kunjungan
                  </label>
                  <select
                    value={modalSlotTime}
                    onChange={e => setModalSlotTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#F4F7FB] dark:bg-[#22123F] border border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-white font-medium"
                  >
                    <option value="">Pertahankan Slot Bawaan WO</option>
                    <option value="09:00 - 11:00 WIB">Slot 1 (09:00 - 11:00 WIB)</option>
                    <option value="11:00 - 13:00 WIB">Slot 2 (11:00 - 13:00 WIB)</option>
                    <option value="13:00 - 15:00 WIB">Slot 3 (13:00 - 15:00 WIB)</option>
                    <option value="15:00 - 17:00 WIB">Slot 4 (15:00 - 17:00 WIB)</option>
                  </select>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E]">
                  <button
                    type="button"
                    onClick={() => setAssignModalOpen(false)}
                    className="mj-btn-leader-neutral px-4 py-2 cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    disabled={isSubmittingAssign || !modalTicketId || !modalInstallerName}
                    onClick={handleConfirmManualAssign}
                    className={`mj-btn-leader-primary px-4 py-2 flex items-center gap-1.5 cursor-pointer ${
                      isSubmittingAssign ? 'mj-btn-loading' : ''
                    }`}
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Konfirmasi Disposisi</span>
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-[#F4F7FB] dark:bg-[#22123F] border border-[#DDE6F0] dark:border-[#35105E]">
                <div className="font-bold text-[#26364A] dark:text-white">
                  Rencana Auto-Balance: {autoBalancePlan.planned.length} WO Siap Didistribusikan
                </div>
                <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] mt-0.5">
                  Algoritma memilih teknisi cakupan area dengan beban terendah dan bebas bentrok slot jadwal.
                </div>
              </div>

              {autoBalancePlan.planned.length === 0 ? (
                <div className="p-4 text-center text-[#8492A5] dark:text-[#CEC0E8]">
                  Tidak ada WO unassigned atau seluruh teknisi area telah mencapai batas kuota harian.
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto divide-y divide-[#E2E8F0] dark:divide-[#35105E] border border-[#DDE6F0] dark:border-[#35105E] rounded-xl">
                  {autoBalancePlan.planned.map(item => (
                    <div key={item.ticket.id} className="p-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono font-bold text-[#5145A6] dark:text-[#dab9ff]">
                          {item.ticket.woNumber}
                        </div>
                        <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] truncate">
                          {item.ticket.customerName} • {item.ticket.clusterName || item.ticket.area}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold text-emerald-700 dark:text-emerald-300">
                          → {item.installer.name}
                        </div>
                        <div className="text-[10px] text-[#8492A5]">
                          {item.slotIndex ? `Slot S${item.slotIndex}` : item.ticket.slotTime || 'Fleksibel'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {autoBalancePlan.skipped.length > 0 && (
                <div className="text-[11px] text-amber-800 dark:text-amber-300 font-medium">
                  {autoBalancePlan.skipped.length} WO dilewati karena kuota teknisi area penuh.
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E]">
                <button
                  type="button"
                  onClick={() => setAssignModalOpen(false)}
                  className="mj-btn-leader-neutral px-4 py-2 cursor-pointer"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  disabled={isSubmittingAssign || autoBalancePlan.planned.length === 0}
                  onClick={handleExecuteAutoBalance}
                  className={`mj-btn-leader-primary px-4 py-2 flex items-center gap-1.5 cursor-pointer ${
                    isSubmittingAssign ? 'mj-btn-loading' : ''
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Eksekusi Auto-Balance ({autoBalancePlan.planned.length} WO)</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </ResponsiveModal>
    </div>
  );
};
