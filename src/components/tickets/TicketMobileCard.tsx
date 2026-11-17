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
    ? 'bg-[#ba1a1a]'
    : isButuhApproval
    ? 'bg-[#825100]'
    : isLiveProgress
    ? 'bg-[#006194]'
    : ticketClosed || ticket.approvalStatus === 'APPROVED'
    ? 'bg-[#16A36A]'
    : 'bg-[#bfc7d2] dark:bg-[#4b386b]';

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
      className={`mj-stitch-card relative overflow-hidden flex flex-col transition-all duration-150 ${
        isSelected
          ? 'ring-2 ring-[#006194] dark:ring-[#93ccff] bg-[#f0f3ff] dark:bg-[#2E1459]'
          : ''
      } ${densityPadding}`}
    >
      {/* Top Semantic Accent Bar matching Stitch Screen 1 */}
      <div className={`absolute top-0 inset-x-0 h-1 ${accentBarClass}`} />

      {/* Header Row: Checkbox + Copyable WO Pill + Category & Slot Time */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => onToggleSelect(ticket.id)}
            className="w-9 h-9 -ml-1.5 flex items-center justify-center rounded-lg text-[#707881] hover:text-[#006194] dark:hover:text-[#93ccff] cursor-pointer shrink-0"
            aria-label={`Pilih ${ticket.woNumber}`}
          >
            {isSelected ? (
              <CheckSquare className="w-4.5 h-4.5 text-[#006194] dark:text-[#93ccff]" />
            ) : (
              <Square className="w-4.5 h-4.5" />
            )}
          </button>

          <button
            type="button"
            onClick={handleCopyWo}
            title="Salin Nomor WO"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#f0f3ff] dark:bg-[#160D29] text-[#111c2d] dark:text-[#D8B4FE] font-mono text-[11px] font-bold tracking-tight hover:bg-[#e7eeff] cursor-pointer tabular-nums"
          >
            <span>{ticket.woNumber}</span>
            {copiedWo ? (
              <Check className="w-3 h-3 text-[#16A36A]" />
            ) : (
              <Copy className="w-3 h-3 text-[#707881]" />
            )}
          </button>

          {ticket.ticketCategory && (
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase truncate max-w-[115px] ${
                isRevision
                  ? 'bg-[#ffdad6] text-[#93000a] dark:bg-rose-950/70 dark:text-rose-200'
                  : 'bg-[#cce5ff]/75 text-[#004b73] dark:bg-[#35105E] dark:text-[#D8B4FE]'
              }`}
            >
              {ticket.ticketCategory}
            </span>
          )}
        </div>

        {/* Right Slot Time / Schedule Badge */}
        {ticket.slotTime && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#e7eeff] dark:bg-[#22123F] text-[#004b73] dark:text-[#93ccff] font-mono text-[10.5px] font-bold tabular-nums shrink-0">
            <Clock className="w-3 h-3 shrink-0" />
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
        <h3 className="font-display font-bold text-[15.5px] text-[#111c2d] dark:text-white leading-snug group-hover:text-[#006194] dark:group-hover:text-[#93ccff] transition-colors line-clamp-1">
          {ticket.customerName}
        </h3>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-[#3f4850] dark:text-[#CEC0E8]">
          <span className="font-mono font-semibold tabular-nums">
            ID: {ticket.idCustomer || '-'}
          </span>
          {ticket.appointmentDate && (
            <>
              <span aria-hidden="true">•</span>
              <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                <Calendar className="w-3 h-3 text-[#006194] dark:text-[#93ccff]" />
                {ticket.appointmentDate}
              </span>
            </>
          )}
        </div>
      </button>

      {/* Location Tonal Card (Stitch Screen 1 `bg-[#f0f3ff]`) */}
      {(addressStr || ticket.clusterName || ticket.fatCode) && (
        <div
          onClick={e => {
            e.stopPropagation();
            openCustomerAddressInGoogleMaps(ticket);
          }}
          className="mj-stitch-tonal-well p-2.5 flex items-start justify-between gap-2 cursor-pointer hover:bg-[#e7eeff] dark:hover:bg-[#22123F] transition-colors"
          title="Ketuk untuk buka Google Maps"
        >
          <div className="flex items-start gap-2 min-w-0">
            <MapPin className="w-4 h-4 text-[#006194] dark:text-[#93ccff] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#111c2d] dark:text-white truncate">
                {ticket.clusterName || ticket.area || 'Lokasi Pelanggan'}
              </p>
              <p className="text-[11px] text-[#3f4850] dark:text-[#CEC0E8] line-clamp-2 leading-snug">
                {addressStr || 'Alamat belum tercatat'}
                {ticket.fatCode ? ` • FAT ${ticket.fatCode}${ticket.fatPort ? ` #${ticket.fatPort}` : ''}` : ''}
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-white dark:bg-[#1E1238] text-[#006194] dark:text-[#93ccff] text-[10px] font-bold shrink-0 shadow-2xs">
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
                ? 'bg-[#006194] text-white'
                : 'bg-[#e7eeff] dark:bg-[#22123F] text-[#3f4850] dark:text-[#CEC0E8]'
            }`}
          >
            {ticket.installerName ? <Wrench className="w-3.5 h-3.5" /> : <Building2 className="w-3.5 h-3.5" />}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-medium text-[#707881] dark:text-[#CEC0E8] leading-none">
              {ticket.installerName ? 'Teknisi Bertugas' : 'Mitra / Penugasan'}
            </span>
            <span className="text-xs font-bold text-[#111c2d] dark:text-white truncate mt-0.5">
              {ticket.installerName || contractorName || 'Belum Ditugaskan'}
            </span>
          </div>
        </div>

        {/* Live / Operational Status Chip */}
        <div className="flex items-center gap-1 shrink-0">
          {isLiveProgress && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#cce5ff] dark:bg-[#35105E] text-[#004b73] dark:text-[#93ccff] text-[10.5px] font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#006194] dark:bg-[#93ccff] animate-pulse" />
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
        {ticket.area && (
          <span className="px-2 py-0.5 rounded bg-[#f0f3ff] dark:bg-[#160D29] text-[#3f4850] dark:text-[#CEC0E8] text-[10px] font-semibold">
            {ticket.area}
          </span>
        )}
      </div>

      {/* Compact Phone / WhatsApp & LiveChat Bar */}
      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[#e7eeff] dark:border-[#35105E]">
        <div className="flex items-center gap-1.5 min-w-0">
          {phoneStr ? (
            <>
              <a
                href={`tel:${phoneStr}`}
                onClick={e => e.stopPropagation()}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#f0f3ff] dark:bg-[#160D29] text-[#111c2d] dark:text-[#E9D5FF] text-[11px] font-mono font-semibold hover:bg-[#e7eeff] truncate"
                title={`Telepon ${phoneStr}`}
              >
                <Phone className="w-3 h-3 text-[#16A36A] shrink-0" />
                <span className="truncate">{phoneStr}</span>
              </a>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  onOpenWhatsApp(ticket);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold hover:bg-emerald-100 cursor-pointer shrink-0"
                title="Buka WhatsApp Pelanggan"
              >
                <MessageSquare className="w-3 h-3" />
                <span>WA</span>
              </button>
            </>
          ) : (
            <span className="text-[11px] text-[#707881] italic">Tanpa nomor kontak</span>
          )}
        </div>

        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onSelectTicket(ticket, 'chat');
          }}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer shrink-0 ${
            unread > 0
              ? 'bg-[#ffdad6] text-[#93000a] dark:bg-rose-950/70 dark:text-rose-200'
              : 'bg-[#f0f3ff] dark:bg-[#22123F] text-[#006194] dark:text-[#93ccff]'
          }`}
        >
          <MessageCircle className="w-3.5 h-3.5" />
          <span>Chat</span>
          {unread > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-[#ba1a1a] text-white text-[9.5px] font-bold tabular-nums">
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
          className={`flex items-center justify-center gap-1.5 px-3 rounded-xl bg-[#e7eeff] dark:bg-[#261942] hover:bg-[#dee8ff] text-[#111c2d] dark:text-[#E9D5FF] font-bold transition-all active:scale-[0.98] cursor-pointer ${
            isComfortableTouch ? 'min-h-[44px] text-xs' : 'min-h-[40px] text-[11px]'
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
            className={`flex items-center justify-center gap-1.5 px-3 rounded-xl bg-[#006194] hover:bg-[#004b73] text-white font-bold shadow-xs transition-all active:scale-[0.98] cursor-pointer ${
              isComfortableTouch ? 'min-h-[44px] text-xs' : 'min-h-[40px] text-[11px]'
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
