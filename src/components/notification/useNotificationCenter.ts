import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { useAnimation } from '../../context/AnimationContext';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { getTicketCanonicalApprovalStatus } from '../../services/woLifecycleService';
import { Ticket, UserRole } from '../../types/index.ts';
import {
  NotificationCategory,
  NotificationFilterState,
  NotificationItem,
  NotificationPriority
} from './notificationTypes';
import { safeLocalStorageGet, safeLocalStorageSet } from '../../utils/safeStorage';

interface StoredNotificationPrefs {
  /** Map of notificationId -> signature at the time it was read */
  readSignatures: Record<string, string>;
  /** Map of notificationId -> signature at the time a read notification was cleared */
  clearedSignatures: Record<string, string>;
}

const DEFAULT_FILTERS: NotificationFilterState = {
  tab: 'all',
  category: 'all',
  priority: 'all',
  dateRange: 'all',
  search: ''
};

const PRIORITY_RANK: Record<NotificationPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3
};

function getStorageKey(userId?: string): string {
  return `morajaws_notif_prefs_v1_${String(userId || 'guest')}`;
}

function loadPrefs(storageKey: string): StoredNotificationPrefs {
  try {
    const raw = safeLocalStorageGet(storageKey);
    if (!raw) return { readSignatures: {}, clearedSignatures: {} };
    const parsed = JSON.parse(raw);
    return {
      readSignatures:
        parsed && typeof parsed.readSignatures === 'object' && parsed.readSignatures
          ? parsed.readSignatures
          : {},
      clearedSignatures:
        parsed && typeof parsed.clearedSignatures === 'object' && parsed.clearedSignatures
          ? parsed.clearedSignatures
          : {}
    };
  } catch {
    return { readSignatures: {}, clearedSignatures: {} };
  }
}

function savePrefs(storageKey: string, prefs: StoredNotificationPrefs): void {
  try {
    safeLocalStorageSet(storageKey, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota errors cleanly
  }
}

function parseAttenuationValue(raw?: string | number | null): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const cleaned = String(raw).replace(',', '.').replace(/[^\d.-]/g, '');
  const val = parseFloat(cleaned);
  return Number.isFinite(val) ? val : null;
}

function toWIBDateOnly(iso?: string, fallback?: string): string {
  if (!iso) return fallback || '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return fallback || '';
    const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    return wib.toISOString().slice(0, 10);
  } catch {
    return fallback || '';
  }
}

export function canRoleNavigateToTab(role: UserRole, tab?: string): boolean {
  if (!tab) return false;
  if (role === 'super_admin') return true;
  const roleTabAccess: Record<UserRole, Set<string>> = {
    super_admin: new Set(),
    dispatch: new Set([
      'dashboard',
      'verification_desk',
      'monitoring_maps',
      'tickets',
      'overdue_wo',
      'form_sameday',
      'report_data_wo',
      'history_progress',
      'schedule',
      'contact_centre',
      'sla_monitoring',
      'templates',
      'sound_settings'
    ]),
    leader: new Set([
      'leader_portal',
      'wo_assignment',
      'reassign_wo',
      'progress_dashboard',
      'installer_mgmt',
      'quota_settings',
      'contractor_recap',
      'monitoring_maps',
      'overdue_wo',
      'tickets',
      'contact_centre',
      'sla_monitoring'
    ]),
    installer: new Set([
      'installer_dashboard',
      'installer_portal',
      'installer_tasks',
      'installer_whatsapp',
      'installer_chat'
    ])
  };
  return roleTabAccess[role]?.has(tab) ?? false;
}

interface UseNotificationCenterOptions {
  onNavigate: (tab: string) => void;
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
}

export function useNotificationCenter({ onNavigate, onSelectTicket }: UseNotificationCenterOptions) {
  const {
    currentUser,
    users,
    tickets,
    scopedTickets,
    overdueTickets,
    overdueSummary,
    todayWIB,
    ticketMessages,
    getTicketUnreadCount,
    databaseStatus,
    syncStatus,
    syncError,
    lastSyncTime,
    isDataLoading,
    dataLoadError,
    refreshDatabaseData,
    globalConflict,
    auditLogs
  } = useApp();

  const { isOnline, pendingCount, isSimulatedOffline, setIsOfflineModalOpen } = useOfflineSync();
  const { activeError } = useAnimation();

  const role = currentUser.role;
  const storageKey = getStorageKey(currentUser.id);
  const [prefs, setPrefs] = useState<StoredNotificationPrefs>(() => loadPrefs(storageKey));
  const [filters, setFilters] = useState<NotificationFilterState>(DEFAULT_FILTERS);

  useEffect(() => {
    setPrefs(loadPrefs(storageKey));
    setFilters(DEFAULT_FILTERS);
  }, [storageKey]);

  const updatePrefs = useCallback(
    (updater: (prev: StoredNotificationPrefs) => StoredNotificationPrefs) => {
      setPrefs(prev => {
        const next = updater(prev);
        savePrefs(storageKey, next);
        return next;
      });
    },
    [storageKey]
  );

  // Build real, role-scoped notifications from live app state (zero dummy data)
  const rawNotifications = useMemo<NotificationItem[]>(() => {
    const items: NotificationItem[] = [];
    const canCentralOps = role === 'super_admin' || role === 'dispatch';
    const canViewOverdue =
      role === 'super_admin' ||
      role === 'dispatch' ||
      role === 'leader';

    const pool = (canCentralOps ? tickets : scopedTickets).filter(
      t => !t.isDeleted && !t.isArchived
    );
    const todayPool = pool.filter(t => getTicketAppointmentDate(t) === todayWIB);

    // Build lookup of latest unread incoming chat message per scoped active ticket
    const currentUserId = String(currentUser.id || '').trim();
    const scopedTicketById = new Map<string, Ticket>();
    const scopedTicketIdByWo = new Map<string, string>();
    for (const t of pool) {
      if (t.id) scopedTicketById.set(t.id, t);
      if (t.woNumber && t.id) {
        scopedTicketIdByWo.set(String(t.woNumber).trim().toUpperCase(), t.id);
      }
    }

    const latestUnreadMsgByTicket = new Map<
      string,
      { id: string; text: string; senderName: string; timestamp: string; hasAttachment: boolean }
    >();
    if (currentUserId && Array.isArray(ticketMessages)) {
      for (const m of ticketMessages) {
        if (!m) continue;
        if (String(m.senderId || '').trim() === currentUserId) continue;
        const readers = Array.isArray(m.readBy) ? m.readBy : [];
        if (readers.includes(currentUserId)) continue;

        let resolvedId: string | undefined;
        if (m.ticketId && scopedTicketById.has(m.ticketId)) {
          resolvedId = m.ticketId;
        } else if (m.woNumber) {
          resolvedId = scopedTicketIdByWo.get(String(m.woNumber).trim().toUpperCase());
        }
        if (!resolvedId) continue;

        const msgTs = m.timestamp || '';
        const existing = latestUnreadMsgByTicket.get(resolvedId);
        const existingMs = existing ? Date.parse(existing.timestamp) : -1;
        const incomingMs = msgTs ? Date.parse(msgTs) : 0;
        if (!existing || (Number.isFinite(incomingMs) && incomingMs >= existingMs)) {
          latestUnreadMsgByTicket.set(resolvedId, {
            id: m.id || '',
            text: String(m.text || '').trim(),
            senderName: String(m.senderName || '').trim(),
            timestamp: msgTs,
            hasAttachment: Array.isArray(m.attachments) && m.attachments.length > 0
          });
        }
      }
    }

    // 1. LIVE CHAT (TOP PRIORITY): Unread messages across role-scoped active WOs
    const unreadChatItems = pool
      .map(t => {
        const unread = getTicketUnreadCount(t.id);
        const latestMsg = latestUnreadMsgByTicket.get(t.id);
        const ts = latestMsg?.timestamp || t.updatedAt || t.createdAt || new Date().toISOString();
        const tsMs = Date.parse(ts);
        return {
          ticket: t,
          unread,
          latestMsg,
          ts,
          tsMs: Number.isFinite(tsMs) ? tsMs : 0
        };
      })
      .filter(entry => entry.unread > 0)
      .sort((a, b) => {
        if (b.tsMs !== a.tsMs) return b.tsMs - a.tsMs;
        return b.unread - a.unread;
      })
      .slice(0, 25);

    for (const { ticket: t, unread, latestMsg, ts } of unreadChatItems) {
      const dateWIB = toWIBDateOnly(ts, getTicketAppointmentDate(t) || todayWIB);
      const previewText = latestMsg?.text
        ? latestMsg.text.length > 90
          ? `${latestMsg.text.slice(0, 90)}…`
          : latestMsg.text
        : latestMsg?.hasAttachment
        ? '[Lampiran foto/dokumen]'
        : '';
      const senderLabel = latestMsg?.senderName ? ` dari ${latestMsg.senderName}` : '';
      const contextLabel = `${t.customerName || 'Pelanggan'} · ${t.area || t.contractorName || 'Operasional WO'}`;

      items.push({
        id: `live-chat-${t.id}`,
        signature: `unread:${unread}:msg:${latestMsg?.id || ''}:ts:${ts}`,
        category: 'live_chat',
        priority: 'high',
        title: `Live Chat Baru${senderLabel} (${unread} belum dibaca)`,
        description: previewText ? `"${previewText}" · ${contextLabel}` : contextLabel,
        timestamp: ts,
        dateWIB,
        woNumber: t.woNumber,
        metaLabel: `${unread} pesan`,
        isRead: false,
        target: {
          type: 'ticket',
          ticket: t,
          defaultTab: 'chat',
          tab: role === 'installer' ? 'installer_chat' : 'contact_centre'
        }
      });
    }

    // 2. WO / ASSIGNMENT & QC QUEUE (Strictly RBAC-scoped)
    if (canCentralOps) {
      const pendingApprovals = pool
        .filter(
          t =>
            getTicketCanonicalApprovalStatus(t) === 'BUTUH APPROVAL' ||
            t.approvalStatus === 'BUTUH APPROVAL'
        )
        .slice(0, 10);

      for (const t of pendingApprovals) {
        const ts = t.updatedAt || t.createdAt || new Date().toISOString();
        const dateWIB = getTicketAppointmentDate(t) || toWIBDateOnly(ts, todayWIB);
        items.push({
          id: `qc-approval-${t.id}`,
          signature: `qc:${t.approvalStatus}:${t.progressReports?.length || 0}:${ts}`,
          category: 'wo_assignment',
          priority: 'high',
          title: `Menunggu Verifikasi QC: ${t.woNumber}`,
          description: `${t.customerName} · Teknisi ${t.installerName || 'belum tercatat'} telah mengirim laporan.`,
          timestamp: ts,
          dateWIB,
          woNumber: t.woNumber,
          metaLabel: 'Approval QC',
          isRead: false,
          target: {
            type: 'ticket',
            ticket: t,
            defaultTab: 'report',
            tab: 'verification_desk'
          }
        });
      }

      const unassignedToday = todayPool.filter(t => !t.installerName || !t.installerName.trim());
      if (unassignedToday.length > 0) {
        items.push({
          id: `ops-unassigned-${todayWIB}`,
          signature: `unassigned:${unassignedToday.length}:${todayWIB}`,
          category: 'wo_assignment',
          priority: unassignedToday.length >= 10 ? 'high' : 'normal',
          title: `${unassignedToday.length} WO Hari Ini Belum Di-Assign`,
          description: `Work order jadwal ${todayWIB} belum memiliki teknisi pelaksana di sistem.`,
          timestamp: new Date().toISOString(),
          dateWIB: todayWIB,
          metaLabel: `${unassignedToday.length} WO`,
          isRead: false,
          target: {
            type: 'tab',
            tab: 'tickets'
          }
        });
      }
    } else if (role === 'leader') {
      const unassignedLeaderToday = todayPool.filter(t => !t.installerName || !t.installerName.trim());
      if (unassignedLeaderToday.length > 0) {
        items.push({
          id: `leader-unassigned-${todayWIB}`,
          signature: `leader-unassigned:${unassignedLeaderToday.length}:${todayWIB}`,
          category: 'wo_assignment',
          priority: unassignedLeaderToday.length >= 5 ? 'high' : 'normal',
          title: `${unassignedLeaderToday.length} WO Mitra Siap Di-Assign`,
          description: `Terdapat WO hari ini (${currentUser.contractor || currentUser.area || 'Scope Mitra'}) yang belum dialokasikan ke installer.`,
          timestamp: new Date().toISOString(),
          dateWIB: todayWIB,
          metaLabel: 'Assign WO',
          isRead: false,
          target: {
            type: 'tab',
            tab: 'wo_assignment'
          }
        });
      }

      const revisionTickets = todayPool
        .filter(t => getTicketCanonicalApprovalStatus(t) === 'REVISION')
        .slice(0, 6);
      for (const t of revisionTickets) {
        const ts = t.updatedAt || t.createdAt || new Date().toISOString();
        items.push({
          id: `leader-rev-${t.id}`,
          signature: `rev:${t.rejectionReason || ''}:${ts}`,
          category: 'wo_assignment',
          priority: 'high',
          title: `Revisi Dispatch pada ${t.woNumber}`,
          description: `${t.installerName || 'Teknisi'} perlu menindaklanjuti catatan revisi untuk pelanggan ${t.customerName}.`,
          timestamp: ts,
          dateWIB: todayWIB,
          woNumber: t.woNumber,
          metaLabel: t.installerName || 'Revisi',
          isRead: false,
          target: {
            type: 'ticket',
            ticket: t,
            defaultTab: 'overview',
            tab: 'progress_dashboard'
          }
        });
      }
    } else if (role === 'installer') {
      const revisionTickets = pool
        .filter(t => getTicketCanonicalApprovalStatus(t) === 'REVISION')
        .slice(0, 6);
      for (const t of revisionTickets) {
        const ts = t.updatedAt || t.createdAt || new Date().toISOString();
        items.push({
          id: `inst-rev-${t.id}`,
          signature: `inst-rev:${t.rejectionReason || ''}:${ts}`,
          category: 'wo_assignment',
          priority: 'critical',
          title: `Revisi Laporan Diperlukan: ${t.woNumber}`,
          description:
            t.rejectionReason ||
            t.progressReports?.[0]?.revisionReason ||
            `Laporan instalasi ${t.customerName} dikembalikan Dispatch untuk perbaikan.`,
          timestamp: ts,
          dateWIB: getTicketAppointmentDate(t) || todayWIB,
          woNumber: t.woNumber,
          metaLabel: 'Revisi Dispatch',
          isRead: false,
          target: {
            type: 'ticket',
            ticket: t,
            defaultTab: 'report',
            tab: 'installer_tasks'
          }
        });
      }

      const highOpmTickets = todayPool
        .filter(t => {
          const val = parseAttenuationValue(t.technicalReport?.opticalPowerDbm || t.rosetRedamanDbm);
          return val !== null && val < -24;
        })
        .slice(0, 4);
      for (const t of highOpmTickets) {
        const rawOpm = t.technicalReport?.opticalPowerDbm ?? t.rosetRedamanDbm ?? '';
        const valStr = String(rawOpm);
        const ts = t.updatedAt || t.createdAt || new Date().toISOString();
        items.push({
          id: `inst-opm-${t.id}`,
          signature: `opm:${valStr}:${ts}`,
          category: 'overdue_warning',
          priority: 'critical',
          title: `Peringatan Redaman OPM Tinggi (${valStr} dBm)`,
          description: `WO ${t.woNumber} (${t.customerName}) melewati batas toleransi -24 dBm. Periksa konektor/dropcore.`,
          timestamp: ts,
          dateWIB: todayWIB,
          woNumber: t.woNumber,
          metaLabel: 'Teknis OPM',
          isRead: false,
          target: {
            type: 'ticket',
            ticket: t,
            defaultTab: 'overview',
            tab: 'installer_tasks'
          }
        });
      }

      const assignedOpenToday = todayPool
        .filter(
          t =>
            getTicketCanonicalApprovalStatus(t) !== 'REVISION' &&
            !['Completed', 'Installed', 'Failed / Cancelled', 'Cancel', 'Cancelled'].includes(
              String(t.statusWOInstaller || '')
            )
        )
        .slice(0, 5);
      for (const t of assignedOpenToday) {
        const ts = t.updatedAt || t.createdAt || new Date().toISOString();
        items.push({
          id: `inst-task-${t.id}`,
          signature: `task:${t.statusWOInstaller || 'Open'}:${t.slotTime || ''}:${ts}`,
          category: 'wo_assignment',
          priority: 'normal',
          title: `Tugas Hari Ini: ${t.woNumber}`,
          description: `${t.customerName}${t.slotTime ? ` · Slot ${t.slotTime}` : ''} · ${t.area || t.address || 'Instalasi'}`,
          timestamp: ts,
          dateWIB: todayWIB,
          woNumber: t.woNumber,
          metaLabel: t.statusWOInstaller || 'Assigned',
          isRead: false,
          target: {
            type: 'ticket',
            ticket: t,
            defaultTab: 'overview',
            tab: 'installer_tasks'
          }
        });
      }
    }

    // 3. OVERDUE / WARNING (Strictly prohibited for Installer)
    if (canViewOverdue) {
      const totalOverdue = overdueSummary?.totalOverdue || overdueTickets.length;
      if (totalOverdue > 0) {
        const highUrgencyOverdue = overdueTickets.filter(t => {
          const d = getTicketAppointmentDate(t);
          return d && d < todayWIB;
        }).length;
        const activeOverdueInPool = overdueTickets.filter(t => !t.installerName || !t.installerName.trim()).length;
        items.push({
          id: `overdue-summary-${todayWIB}`,
          signature: `overdue:${totalOverdue}:${highUrgencyOverdue}`,
          category: 'overdue_warning',
          priority: totalOverdue >= 15 || (overdueSummary?.criticalOverdueGt7Days || 0) > 0 ? 'critical' : 'high',
          title: `${totalOverdue} Work Order Berstatus Overdue`,
          description: `${overdueSummary?.criticalOverdueGt7Days || 0} kritis (>7 hr) · ${activeOverdueInPool} belum ter-assign melewati jadwal.`,
          timestamp: new Date().toISOString(),
          dateWIB: todayWIB,
          metaLabel: 'Overdue SLA',
          isRead: false,
          target: {
            type: 'tab',
            tab: 'overdue_wo'
          }
        });

        for (const ot of overdueTickets.slice(0, 3)) {
          const ts = ot.updatedAt || ot.createdAt || new Date().toISOString();
          items.push({
            id: `overdue-wo-${ot.id}`,
            signature: `ot:${ot.statusWOInstaller || ''}:${ot.installerName || ''}:${ts}`,
            category: 'overdue_warning',
            priority: 'high',
            title: `Overdue: ${ot.woNumber} (${ot.customerName})`,
            description: `Jadwal ${getTicketAppointmentDate(ot) || '-'} · ${ot.area || ot.contractorName || 'Area belum tercatat'}`,
            timestamp: ts,
            dateWIB: getTicketAppointmentDate(ot) || todayWIB,
            woNumber: ot.woNumber,
            metaLabel: ot.installerName || 'Unassigned',
            isRead: false,
            target: {
              type: 'ticket',
              ticket: ot,
              defaultTab: 'overview',
              tab: 'overdue_wo'
            }
          });
        }
      }
    }

    // 4. SYSTEM / DATABASE & OFFLINE SYNC
    if (!isOnline || pendingCount > 0) {
      items.push({
        id: 'system-offline-queue',
        signature: `offline:${isOnline ? 'online' : 'offline'}:${isSimulatedOffline ? 'sim' : 'real'}:${pendingCount}`,
        category: 'system_database',
        priority: !isOnline && pendingCount > 0 ? 'high' : 'normal',
        title: !isOnline
          ? isSimulatedOffline
            ? 'Mode Simulasi Offline Aktif'
            : 'Koneksi Jaringan Terputus (Offline)'
          : `${pendingCount} Mutasi Offline Menunggu Sinkronisasi`,
        description:
          pendingCount > 0
            ? `${pendingCount} perubahan lapangan tersimpan lokal dan siap disinkronkan ke PostgreSQL.`
            : 'Perubahan lokal akan ditampung aman sampai koneksi pulih.',
        timestamp: new Date().toISOString(),
        dateWIB: todayWIB,
        metaLabel: `${pendingCount} antrean`,
        isRead: false,
        target: {
          type: 'offline_sync'
        }
      });
    }

    if (databaseStatus === 'error' || syncStatus === 'ERROR' || dataLoadError || syncError) {
      const errText = dataLoadError || syncError || 'Sinkronisasi PostgreSQL perlu perhatian.';
      items.push({
        id: 'system-db-error',
        signature: `db-err:${databaseStatus}:${syncStatus}:${errText}`,
        category: 'system_database',
        priority: 'critical',
        title: 'Gangguan Sinkronisasi Database Cloud',
        description: errText,
        timestamp: lastSyncTime || new Date().toISOString(),
        dateWIB: todayWIB,
        metaLabel: databaseStatus.toUpperCase(),
        isRead: false,
        target: canRoleNavigateToTab(role, 'system_health')
          ? { type: 'tab', tab: 'system_health' }
          : { type: 'refresh' }
      });
    }

    if (globalConflict && role === 'super_admin') {
      items.push({
        id: `system-conflict-${globalConflict.key}`,
        signature: `conflict:${globalConflict.key}:${globalConflict.currentVersion ?? ''}`,
        category: 'system_database',
        priority: 'high',
        title: `Konflik Versi Konfigurasi: ${globalConflict.key}`,
        description: 'Versi konfigurasi server berbeda dengan sesi lokal. Harap tinjau sebelum menyimpan ulang.',
        timestamp: new Date().toISOString(),
        dateWIB: todayWIB,
        metaLabel: 'Config Conflict',
        isRead: false,
        target: canRoleNavigateToTab(role, 'system_health')
          ? { type: 'tab', tab: 'system_health' }
          : { type: 'refresh' }
      });
    }

    // 5. SECURITY (Strictly for Superadmin on real security / locked accounts / auth errors)
    if (role === 'super_admin') {
      const lockedUsers = (users || []).filter(
        u => !u.isDeleted && u.accountStatus === 'locked'
      );
      if (lockedUsers.length > 0) {
        items.push({
          id: 'security-locked-accounts',
          signature: `locked:${lockedUsers.map(u => u.id).sort().join(',')}`,
          category: 'security',
          priority: 'critical',
          title: `${lockedUsers.length} Akun Pengguna Terkunci (Locked)`,
          description: `Terdeteksi akun terkunci (${lockedUsers.slice(0, 2).map(u => u.username).join(', ')}). Periksa keamanan login.`,
          timestamp: new Date().toISOString(),
          dateWIB: todayWIB,
          metaLabel: 'Account Lock',
          isRead: false,
          target: canRoleNavigateToTab(role, 'login_logs')
            ? { type: 'tab', tab: 'login_logs' }
            : canRoleNavigateToTab(role, 'users')
            ? { type: 'tab', tab: 'users' }
            : undefined
        });
      }

      if (activeError && activeError.module === 'Authentication') {
        items.push({
          id: `security-alert-${activeError.errorCode || 'auth'}`,
          signature: `sec-err:${activeError.errorCode || ''}:${activeError.message || activeError.description || ''}`,
          category: 'security',
          priority: 'critical',
          title: activeError.operation || 'Peringatan Keamanan / Autentikasi',
          description: activeError.description || activeError.message || 'Gangguan keamanan autentikasi terdeteksi.',
          timestamp: new Date().toISOString(),
          dateWIB: todayWIB,
          metaLabel: activeError.errorCode || 'Security',
          isRead: false,
          target: canRoleNavigateToTab(role, 'audit_logs')
            ? { type: 'tab', tab: 'audit_logs' }
            : undefined
        });
      }

      const recentSecurityAudits = (auditLogs || [])
        .filter(log => {
          const act = String(log.action || '').toUpperCase();
          return (
            act.includes('LOCK') ||
            act.includes('FAIL') ||
            act.includes('DENIED') ||
            act.includes('PASSWORD_RESET') ||
            act.includes('DELETE')
          );
        })
        .slice(0, 3);

      for (const log of recentSecurityAudits) {
        items.push({
          id: `security-audit-${log.id}`,
          signature: `audit:${log.id}:${log.timestamp}`,
          category: 'security',
          priority: String(log.action || '').toUpperCase().includes('LOCK') ? 'high' : 'normal',
          title: `Audit Keamanan: ${log.action}`,
          description: `${log.performedBy || 'System'} · ${log.details || log.entity}`,
          timestamp: log.timestamp || new Date().toISOString(),
          dateWIB: toWIBDateOnly(log.timestamp, todayWIB),
          metaLabel: log.userRole || 'Audit',
          isRead: false,
          target: canRoleNavigateToTab(role, 'audit_logs')
            ? { type: 'tab', tab: 'audit_logs' }
            : undefined
        });
      }
    }

    // 6. SUCCESS (Genuine operational completion / healthy live sync milestone)
    if (todayPool.length > 0) {
      const completedToday = todayPool.filter(
        t =>
          String(t.statusWOAgent || '').trim().toLowerCase() === 'closed' ||
          getTicketCanonicalApprovalStatus(t) === 'APPROVED' ||
          ['Completed', 'Installed'].includes(String(t.statusWOInstaller || ''))
      ).length;

      if (completedToday === todayPool.length) {
        items.push({
          id: `success-daily-complete-${todayWIB}`,
          signature: `complete:${completedToday}:${todayWIB}`,
          category: 'success',
          priority: 'low',
          title: `Seluruh ${completedToday} WO Hari Ini Selesai`,
          description: `Target WO aktif tanggal ${todayWIB} pada cakupan peran Anda telah rampung 100%.`,
          timestamp: lastSyncTime || new Date().toISOString(),
          dateWIB: todayWIB,
          metaLabel: '100% Complete',
          isRead: false,
          target: canRoleNavigateToTab(role, role === 'installer' ? 'installer_tasks' : 'tickets')
            ? { type: 'tab', tab: role === 'installer' ? 'installer_tasks' : 'tickets' }
            : undefined
        });
      }
    }

    // Apply persisted read & cleared state cleanly without mutating backend records
    return items
      .filter(item => prefs.clearedSignatures[item.id] !== item.signature)
      .map(item => ({
        ...item,
        isRead: prefs.readSignatures[item.id] === item.signature
      }))
      .sort((a, b) => {
        if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
        const aIsLiveChat = a.category === 'live_chat';
        const bIsLiveChat = b.category === 'live_chat';
        if (aIsLiveChat !== bIsLiveChat) return aIsLiveChat ? -1 : 1;
        const prioDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (prioDiff !== 0) return prioDiff;
        return Date.parse(b.timestamp) - Date.parse(a.timestamp);
      });
  }, [
    role,
    currentUser.id,
    tickets,
    scopedTickets,
    ticketMessages,
    overdueTickets,
    overdueSummary,
    todayWIB,
    getTicketUnreadCount,
    currentUser.contractor,
    currentUser.area,
    isOnline,
    isSimulatedOffline,
    pendingCount,
    databaseStatus,
    syncStatus,
    dataLoadError,
    syncError,
    lastSyncTime,
    globalConflict,
    users,
    activeError,
    auditLogs,
    prefs
  ]);

  const counts = useMemo(() => {
    const all = rawNotifications.length;
    const unread = rawNotifications.filter(n => !n.isRead).length;
    const read = all - unread;
    const hasCriticalUnread = rawNotifications.some(n => !n.isRead && n.priority === 'critical');
    const liveChatUnread = rawNotifications.filter(
      n => n.category === 'live_chat' && !n.isRead
    ).length;
    const liveChatTotal = rawNotifications.filter(n => n.category === 'live_chat').length;
    return { all, unread, read, hasCriticalUnread, liveChatUnread, liveChatTotal };
  }, [rawNotifications]);

  const availableCategories = useMemo<NotificationCategory[]>(() => {
    if (role === 'installer') {
      return ['live_chat', 'wo_assignment', 'overdue_warning', 'system_database', 'success'];
    }
    if (role === 'super_admin') {
      return ['live_chat', 'wo_assignment', 'overdue_warning', 'system_database', 'success', 'security'];
    }
    return ['live_chat', 'wo_assignment', 'overdue_warning', 'system_database', 'success'];
  }, [role]);

  const filteredNotifications = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

    return rawNotifications.filter(item => {
      if (filters.tab === 'unread' && item.isRead) return false;
      if (filters.tab === 'read' && !item.isRead) return false;
      if (filters.category !== 'all' && item.category !== filters.category) return false;
      if (filters.priority !== 'all' && item.priority !== filters.priority) return false;

      if (filters.dateRange === 'today' && item.dateWIB !== todayWIB) return false;
      if (filters.dateRange === 'last_7_days') {
        const ts = Date.parse(item.timestamp);
        if (Number.isFinite(ts) && ts < sevenDaysAgoMs) return false;
      }

      if (q) {
        const haystack = `${item.title} ${item.description} ${item.woNumber || ''} ${item.metaLabel || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [rawNotifications, filters, todayWIB]);

  const markAsRead = useCallback(
    (id: string) => {
      const target = rawNotifications.find(n => n.id === id);
      if (!target) return;
      updatePrefs(prev => ({
        ...prev,
        readSignatures: {
          ...prev.readSignatures,
          [target.id]: target.signature
        }
      }));
    },
    [rawNotifications, updatePrefs]
  );

  const markAllAsRead = useCallback(() => {
    if (rawNotifications.length === 0) return;
    updatePrefs(prev => {
      const nextRead = { ...prev.readSignatures };
      for (const item of rawNotifications) {
        nextRead[item.id] = item.signature;
      }
      return {
        ...prev,
        readSignatures: nextRead
      };
    });
  }, [rawNotifications, updatePrefs]);

  const clearReadNotifications = useCallback(() => {
    const readItems = rawNotifications.filter(n => n.isRead);
    if (readItems.length === 0) return;
    updatePrefs(prev => {
      const nextCleared = { ...prev.clearedSignatures };
      for (const item of readItems) {
        nextCleared[item.id] = item.signature;
      }
      return {
        ...prev,
        clearedSignatures: nextCleared
      };
    });
  }, [rawNotifications, updatePrefs]);

  const updateFilters = useCallback((next: Partial<NotificationFilterState>) => {
    setFilters(prev => ({ ...prev, ...next }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const handleSelectNotification = useCallback(
    (item: NotificationItem, afterNavigate?: () => void) => {
      markAsRead(item.id);
      const target = item.target;
      if (!target) {
        afterNavigate?.();
        return;
      }

      if (target.type === 'offline_sync') {
        setIsOfflineModalOpen(true);
        afterNavigate?.();
        return;
      }

      if (target.type === 'refresh') {
        void refreshDatabaseData();
        afterNavigate?.();
        return;
      }

      if (target.type === 'ticket' && target.ticket) {
        if (onSelectTicket) {
          onSelectTicket(target.ticket, target.defaultTab || 'overview');
        } else if (target.tab && canRoleNavigateToTab(role, target.tab)) {
          onNavigate(target.tab);
        }
        afterNavigate?.();
        return;
      }

      if (target.type === 'tab' && target.tab && canRoleNavigateToTab(role, target.tab)) {
        onNavigate(target.tab);
      }
      afterNavigate?.();
    },
    [markAsRead, onNavigate, onSelectTicket, refreshDatabaseData, role, setIsOfflineModalOpen]
  );

  return {
    notifications: rawNotifications,
    filteredNotifications,
    counts,
    filters,
    availableCategories,
    isLoading: isDataLoading && rawNotifications.length === 0,
    error: syncStatus === 'ERROR' || Boolean(dataLoadError) ? dataLoadError || syncError : null,
    updateFilters,
    resetFilters,
    markAsRead,
    markAllAsRead,
    clearReadNotifications,
    handleSelectNotification,
    retrySync: refreshDatabaseData
  };
}
