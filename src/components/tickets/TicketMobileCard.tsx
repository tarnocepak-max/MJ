import React, { useState } from 'react';
import { Ticket } from '../../types/index.ts';
import { useUIConfig } from '../../context/UIConfigContext';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import {
  StatusAgentBadge,
  StatusInstallerBadge,
  StatusWhatsAppBadge,
  StatusApprovalBadge
} from '../common/Badge';
import { isTicketClosed } from '../../services/woLifecycleService';
import { openCustomerAddressInGoogleMaps } from '../../services/mapsService';
import {
  MessageSquare,
  MessageCircle,
  Eye,
  Phone,
  Clock,
  MapPin,
  Wrench,
  CheckSquare,
  Square,
  Calendar,
  Copy,
  Check,
  Zap,
  ExternalLink,
  Building2
} from 'lucide-react';

interface TicketMobileCardProps {
  ticket: Ticket;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onSelectTicket: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp: (ticket: Ticket) => void;
  onQuickUpdate?: (ticket: Ticket) => void;
}

export const TicketMobileCard: React.FC<TicketMobileCardProps> = ({
  ticket,
  isSelected,
  onToggleSelect,
  onSelectTicket,
  onOpenWhatsApp,
  onQuickUpdate
}) => {
  const { config } = useUIConfig();
  const { currentUser, getTicketUnreadCount } = useApp();
  const { toast } = useToast();
  const [copiedWo, setCopiedWo] = useState(false);

  const androidConfig = config.device?.android || {
    touchTargetSize: 'comfortable',
    cardDensity: 'comfortable',
    showQuickCall: true,
    showQuickWhatsApp: true,
    showQuickDetail: true,
    highContrastBadges: true
  };

  const isComfortableTouch = androidConfig.touchTargetSize !== 'compact';
  const densityPadding =
    androidConfig.cardDensity === 'spacious'
      ? 'p-4 gap-3'
      : androidConfig.cardDensity === 'compact'
      ? 'p-3 gap-2'
      : 'p-3.5 gap-2.5';

  const ticketClosed = isTicketClosed(ticket);
  const unread = getTicketUnreadCount(ticket.id);
  const isRevision = ticket.approvalStatus === 'REJECTED' || ticket.approvalStatus === 'REVISI';
  const isButuhApproval = ticket.approvalStatus === 'BUTUH APPROVAL';
  const isLiveProgress =
    !ticketClosed &&
    ['En Route', 'On Site', 'In Progress', 'PROGRESS'].includes(String(ticket.statusWOInstaller));

  const accentBarClass = isRevision
    ? 'bg-rose-600'
    : isButuhApproval
    ? 'bg-amber-600'
    : isLiveProgress
    ? 'bg-[#2563EB]'
    : ticketClosed || ticket.approvalStatus === 'APPROVED'
    ? 'bg-emerald-600'
    : 'bg-slate-300 dark:bg-slate-700';

  const canQuickUpdate =
    Boolean(onQuickUpdate) &&
    !ticketClosed &&
    currentUser?.role !== 'leader';

  const handleCopyWo = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(ticket.woNumber);
      setCopiedWo(true);
      toast.info(`Nomor WO ${ticket.woNumber} disalin.`);
      setTimeout(() => setCopiedWo(false), 1500);
    } catch {
      toast.error('Gagal menyalin Nomor WO.');
    }
  };

  const contractorName = ticket.contactorName || ticket.contractorName || '';
  const phoneStr = ticket.customerPhone || (ticket as any).phoneNumber || '';
  const addressStr =
    ticket.streetName ||
    (ticket as any).customerAddress ||
    (ticket as any).address ||
    ticket.area ||
    '';

  return (
    <article
      className={`relative overflow-hidden rounded-2xl border bg-white dark:bg-[#0F172A] shadow-2xs flex flex-col transition-all duration-150 ${
        isSelected
          ? 'ring-2 ring-[#2563EB] dark:ring-[#38BDF8] border-[#2563EB] bg-blue-50/40 dark:bg-blue-950/30'
          : 'border-slate-200 dark:border-slate-800'
      } ${densityPadding}`}
    >
      {/* Top Semantic Accent Bar */}
      <div className={`absolute top-0 inset-x-0 h-1 ${accentBarClass}`} />

      {/* Header Row: Checkbox + Copyable WO Pill + Category & Slot Time */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => onToggleSelect(ticket.id)}
            className="w-10 h-10 -ml-1.5 flex items-center justify-center rounded-lg text-slate-400 hover:text-[#2563EB] dark:hover:text-[#38BDF8] cursor-pointer shrink-0"
            aria-label={`Pilih ${ticket.woNumber}`}
          >
            {isSelected ? (
              <CheckSquare className="w-4.5 h-4.5 text-[#2563EB] dark:text-[#38BDF8]" />
            ) : (
              <Square className="w-4.5 h-4.5" />
            )}
          </button>

          <button
            type="button"
            onClick={handleCopyWo}
            title="Salin Nomor WO"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#1E293B] text-slate-900 dark:text-[#38BDF8] border border-slate-200 dark:border-slate-700 font-mono text-[11px] font-bold tracking-tight hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer tabular-nums"
          >
            <span>{ticket.woNumber}</span>
            {copiedWo ? (
              <Check className="w-3 h-3 text-emerald-600" />
            ) : (
              <Copy className="w-3 h-3 text-slate-400" />
            )}
          </button>

          {ticket.ticketCategory && (
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase truncate max-w-[115px] ${
                isRevision
                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-200'
                  : 'bg-blue-50 text-[#2563EB] dark:bg-blue-950/60 dark:text-[#38BDF8]'
              }`}
            >
              {ticket.ticketCategory}
            </span>
          )}
        </div>

        {/* Right Slot Time / Schedule Badge */}
        {ticket.slotTime && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-[#1E293B] text-slate-700 dark:text-[#38BDF8] border border-slate-200 dark:border-slate-700 font-mono text-[10.5px] font-bold tabular-nums shrink-0">
            <Clock className="w-3 h-3 shrink-0 text-[#2563EB] dark:text-[#38BDF8]" />
            <span>{ticket.slotTime}</span>
          </span>
        )}
      </div>

      {/* Customer Name Title */}
      <button
        type="button"
        onClick={() => onSelectTicket(ticket, 'overview')}
        className="text-left group cursor-pointer"
      >
        <h3 className="font-display font-bold text-[15.5px] text-slate-900 dark:text-white leading-snug group-hover:text-[#2563EB] dark:group-hover:text-[#38BDF8] transition-colors line-clamp-1">
          {ticket.customerName}
        </h3>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="font-mono font-semibold tabular-nums">
            ID: {ticket.idCustomer || '-'}
          </span>
          {ticket.appointmentDate && (
            <>
              <span aria-hidden="true">•</span>
              <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                <Calendar className="w-3 h-3 text-[#2563EB] dark:text-[#38BDF8]" />
                {ticket.appointmentDate}
              </span>
            </>
          )}
        </div>
      </button>

      {/* Location Tonal Card */}
      {(addressStr || ticket.clusterName || ticket.fatCode) && (
        <div
          onClick={e => {
            e.stopPropagation();
            openCustomerAddressInGoogleMaps(ticket);
          }}
          className="rounded-xl bg-slate-50 dark:bg-[#1E293B] border border-slate-200/80 dark:border-slate-700 p-2.5 flex items-start justify-between gap-2 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Ketuk untuk buka Google Maps"
        >
          <div className="flex items-start gap-2 min-w-0">
            <MapPin className="w-4 h-4 text-[#2563EB] dark:text-[#38BDF8] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                {ticket.clusterName || ticket.area || 'Lokasi Pelanggan'}
              </p>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2 leading-snug">
                {addressStr || 'Alamat belum tercatat'}
                {ticket.fatCode ? ` • FAT ${ticket.fatCode}${ticket.fatPort ? ` #${ticket.fatPort}` : ''}` : ''}
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-0.5 px-2 py-1 rounded-md bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-700 text-[#2563EB] dark:text-[#38BDF8] text-[10px] font-bold shrink-0">
            <span>Maps</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </span>
        </div>
      )}

      {/* Technician & Vendor Assignment Row */}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
              ticket.installerName
                ? 'bg-[#2563EB] text-white'
                : 'bg-slate-100 dark:bg-[#1E293B] text-slate-500 dark:text-slate-300'
            }`}
          >
            {ticket.installerName ? <Wrench className="w-3.5 h-3.5" /> : <Building2 className="w-3.5 h-3.5" />}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 leading-none">
              {ticket.installerName ? 'Teknisi Bertugas' : 'Mitra / Penugasan'}
            </span>
            <span className="text-xs font-bold text-slate-900 dark:text-white truncate mt-0.5">
              {ticket.installerName || contractorName || 'Belum Ditugaskan'}
            </span>
          </div>
        </div>

        {/* Live / Operational Status Chip */}
        <div className="flex items-center gap-1 shrink-0">
          {isLiveProgress && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/60 text-[#2563EB] dark:text-[#38BDF8] border border-blue-200 dark:border-blue-800 text-[10.5px] font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] dark:bg-[#38BDF8]" />
              <span>{ticket.statusWOInstaller}</span>
            </span>
          )}
          {!isLiveProgress && <StatusInstallerBadge status={ticket.statusWOInstaller} />}
        </div>
      </div>

      {/* Metadata Badges Strip */}
      <div className="flex flex-wrap items-center gap-1.5">
        {ticket.approvalStatus && ticket.approvalStatus !== 'NONE' && (
          <StatusApprovalBadge status={ticket.approvalStatus} />
        )}
        <StatusWhatsAppBadge status={ticket.statusWhatsApp} />
        <StatusAgentBadge status={ticket.statusWOAgent} />
        {ticketClosed && ticket.statusWOAgent !== 'Closed' && (
          <span className="px-2 py-0.5 rounded bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 text-[10px] font-bold">
            Ticket: Closed
          </span>
        )}
        {ticket.area && (
          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#1E293B] text-slate-600 dark:text-slate-300 text-[10px] font-semibold">
            {ticket.area}
          </span>
        )}
      </div>

      {/* Compact Phone / WhatsApp & LiveChat Bar */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-1.5 min-w-0">
          {phoneStr ? (
            <>
              <a
                href={`tel:${phoneStr}`}
                onClick={e => e.stopPropagation()}
                className="inline-flex items-center gap-1 px-2.5 min-h-[38px] rounded-lg bg-slate-100 dark:bg-[#1E293B] text-slate-800 dark:text-slate-200 text-[11px] font-mono font-semibold hover:bg-slate-200 truncate"
                title={`Telepon ${phoneStr}`}
              >
                <Phone className="w-3 h-3 text-emerald-600 shrink-0" />
                <span className="truncate">{phoneStr}</span>
              </a>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  onOpenWhatsApp(ticket);
                }}
                className="inline-flex items-center gap-1 px-2.5 min-h-[38px] rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 text-[11px] font-bold hover:bg-emerald-100 cursor-pointer shrink-0"
                title="Buka WhatsApp Pelanggan"
              >
                <MessageSquare className="w-3 h-3" />
                <span>WA</span>
              </button>
            </>
          ) : (
            <span className="text-[11px] text-slate-400 italic">Tanpa nomor kontak</span>
          )}
        </div>

        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onSelectTicket(ticket, 'chat');
          }}
          className={`inline-flex items-center gap-1.5 px-3 min-h-[38px] rounded-lg text-[11px] font-bold cursor-pointer shrink-0 border ${
            unread > 0
              ? 'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-950/70 dark:border-rose-800 dark:text-rose-200'
              : 'bg-blue-50 border-blue-200 text-[#2563EB] dark:bg-blue-950/50 dark:border-blue-800 dark:text-[#38BDF8]'
          }`}
        >
          <MessageCircle className="w-3.5 h-3.5" />
          <span>Chat</span>
          {unread > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-rose-600 text-white text-[9.5px] font-bold tabular-nums">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </div>

      {/* Thumb-Zone Bottom CTA Row (Lihat Detail + Update Cepat) */}
      <div className={`grid gap-2 pt-1 ${canQuickUpdate ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <button
          type="button"
          onClick={() => onSelectTicket(ticket, 'overview')}
          className={`flex items-center justify-center gap-1.5 px-3 rounded-xl bg-slate-100 dark:bg-[#1E293B] hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 font-bold transition-all active:scale-[0.98] cursor-pointer ${
            isComfortableTouch ? 'min-h-[44px] text-xs' : 'min-h-[42px] text-[11px]'
          }`}
        >
          <Eye className="w-4 h-4 shrink-0" />
          <span>Lihat Detail</span>
        </button>

        {canQuickUpdate && (
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              onQuickUpdate?.(ticket);
            }}
            className={`flex items-center justify-center gap-1.5 px-3 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-bold shadow-xs transition-all active:scale-[0.98] cursor-pointer ${
              isComfortableTouch ? 'min-h-[44px] text-xs' : 'min-h-[42px] text-[11px]'
            }`}
          >
            <Zap className="w-4 h-4 shrink-0" />
            <span>Update Cepat</span>
          </button>
        )}
      </div>
    </article>
  );
};
