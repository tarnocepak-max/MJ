import React, { useState } from 'react';
import { Ticket } from '../../types/index.ts';
import { useUIConfig } from '../../context/UIConfigContext';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { normalizeAndroidCardSettings } from '../../utils/uiLayoutHelpers';
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
  ExternalLink,
  Building2
} from 'lucide-react';

interface TicketMobileCardProps {
  ticket: Ticket;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onSelectTicket: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp: (ticket: Ticket) => void;
}

export const TicketMobileCard: React.FC<TicketMobileCardProps> = ({
  ticket,
  isSelected,
  onToggleSelect,
  onSelectTicket,
  onOpenWhatsApp
}) => {
  const { config } = useUIConfig();
  const { getTicketUnreadCount } = useApp();
  const { toast } = useToast();
  const [copiedWo, setCopiedWo] = useState(false);

  const androidConfig = normalizeAndroidCardSettings(config.device?.android);

  const ticketClosed = isTicketClosed(ticket);
  const unread = getTicketUnreadCount(ticket.id);
  const isComfortableTouch = androidConfig.touchTargetSize !== 'standard';
  const showQuickBar =
    androidConfig.showQuickCall || androidConfig.showQuickWhatsApp || unread >= 0;
  const densityPadding =
    androidConfig.cardDensity === 'spacious'
      ? 'p-4 gap-3'
      : androidConfig.cardDensity === 'compact'
      ? 'p-3 gap-2'
      : 'p-3.5 gap-2.5';

  const isRevision = ticket.approvalStatus === 'REJECTED' || ticket.approvalStatus === 'REVISI';
  const isButuhApproval = ticket.approvalStatus === 'BUTUH APPROVAL';
  const isLiveProgress =
    !ticketClosed &&
    ['En Route', 'On Site', 'In Progress', 'PROGRESS'].includes(String(ticket.statusWOInstaller));

  const accentBarClass = isRevision
    ? 'bg-[#D45B66]'
    : isButuhApproval
    ? 'bg-[#C88735]'
    : isLiveProgress
    ? 'bg-gradient-to-r from-[#6657C8] to-[#65B8C4] dark:from-[#7135B5] dark:to-[#58149C]'
    : ticketClosed || ticket.approvalStatus === 'APPROVED'
    ? 'bg-[#218A63]'
    : 'bg-[#DCE3F2] dark:bg-[#4B386B]';

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
      className={`card-3d-lavender relative overflow-hidden rounded-2xl flex flex-col transition-all duration-150 ${
        isSelected
          ? 'ring-2 ring-[#6657C8] dark:ring-[#D8B4FE] border-[#6657C8] bg-[#EAE8FF]/80 dark:bg-[#2E1459]/90'
          : ''
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
            className="w-10 h-10 -ml-1.5 flex items-center justify-center rounded-lg text-[#8492A5] dark:text-[#C5B3DF] hover:text-[#5145A6] dark:hover:text-[#DAB9FF] cursor-pointer shrink-0"
            aria-label={`Pilih ${ticket.woNumber}`}
          >
            {isSelected ? (
              <CheckSquare className="w-4.5 h-4.5 text-[#5145A6] dark:text-[#DAB9FF]" />
            ) : (
              <Square className="w-4.5 h-4.5" />
            )}
          </button>

          <button
            type="button"
            onClick={handleCopyWo}
            title="Salin Nomor WO"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#F8FAFD] dark:bg-[#160D29] text-[#5145A6] dark:text-[#DAB9FF] border border-[#DDE6F0] dark:border-[#4B386B] font-mono text-[11px] font-bold tracking-tight hover:bg-[#EAE8FF] dark:hover:bg-[#241145] cursor-pointer tabular-nums shadow-[0_1.5px_0_#DDE6F0] dark:shadow-none"
          >
            <span>{ticket.woNumber}</span>
            {copiedWo ? (
              <Check className="w-3 h-3 text-[#218A63] dark:text-emerald-600" />
            ) : (
              <Copy className="w-3 h-3 text-[#8492A5] dark:text-[#C5B3DF]" />
            )}
          </button>

          {ticket.ticketCategory && (
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase truncate max-w-[115px] ${
                isRevision
                  ? 'bg-[#FCE9EB] text-[#9B2C37] dark:bg-rose-950/70 dark:text-rose-200'
                  : 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2E1459] dark:text-[#D8B4FE]'
              }`}
            >
              {ticket.ticketCategory}
            </span>
          )}
        </div>

        {/* Right Slot Time / Schedule Badge */}
        {ticket.slotTime && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#EDF3F8] dark:bg-[#160D29] text-[#26364A] dark:text-[#DAB9FF] border border-[#DDE6F0] dark:border-[#4B386B] font-mono text-[10.5px] font-bold tabular-nums shrink-0">
            <Clock className="w-3 h-3 shrink-0 text-[#2E7D8B] dark:text-[#DAB9FF]" />
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
        <h3 className="font-display font-bold text-[15.5px] text-[#26364A] dark:text-white leading-snug group-hover:text-[#5145A6] dark:group-hover:text-[#DAB9FF] transition-colors line-clamp-1">
          {ticket.customerName}
        </h3>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-[#8492A5] dark:text-[#C5B3DF]">
          <span className="font-mono font-semibold tabular-nums">
            ID: {ticket.idCustomer || '-'}
          </span>
          {ticket.appointmentDate && (
            <>
              <span aria-hidden="true">•</span>
              <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                <Calendar className="w-3 h-3 text-[#5145A6] dark:text-[#DAB9FF]" />
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
          className="mj-tactile-well rounded-xl p-2.5 flex items-start justify-between gap-2 cursor-pointer hover:bg-[#EDF3F8] dark:hover:bg-[#241145] transition-colors"
          title="Ketuk untuk buka Google Maps"
        >
          <div className="flex items-start gap-2 min-w-0">
            <MapPin className="w-4 h-4 text-[#2E7D8B] dark:text-[#DAB9FF] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#26364A] dark:text-white truncate">
                {ticket.clusterName || ticket.area || 'Lokasi Pelanggan'}
              </p>
              <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] whitespace-normal break-words leading-snug">
                {addressStr || 'Alamat belum tercatat'}
                {ticket.fatCode ? ` • FAT ${ticket.fatCode}${ticket.fatPort ? ` #${ticket.fatPort}` : ''}` : ''}
              </p>
            </div>
          </div>
          <span className="btn-3d-lilac inline-flex items-center gap-0.5 px-2 py-1 rounded-md text-[10px] font-bold shrink-0">
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
                ? 'bg-gradient-to-b from-[#6657C8] to-[#5145A6] dark:from-[#7135B5] dark:to-[#58149C] text-white shadow-[0_2px_0_#3E3588] dark:shadow-[0_2px_0_#35105E]'
                : 'bg-[#F8FAFD] dark:bg-[#160D29] text-[#8492A5] dark:text-[#C5B3DF] border border-[#DDE6F0] dark:border-[#4B386B]'
            }`}
          >
            {ticket.installerName ? <Wrench className="w-3.5 h-3.5" /> : <Building2 className="w-3.5 h-3.5" />}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-medium text-[#8492A5] dark:text-[#C5B3DF] leading-none">
              {ticket.installerName ? 'Teknisi Bertugas' : 'Mitra / Penugasan'}
            </span>
            <span className="text-xs font-bold text-[#26364A] dark:text-white truncate mt-0.5">
              {ticket.installerName || contractorName || 'Belum Ditugaskan'}
            </span>
          </div>
        </div>

        {/* Live / Operational Status Chip */}
        <div className="flex items-center gap-1 shrink-0">
          {isLiveProgress && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#EAE8FF] dark:bg-[#2E1459] text-[#5145A6] dark:text-[#D8B4FE] border border-[#DCE3F2] dark:border-[#5B35B1] text-[10.5px] font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#6657C8] dark:bg-[#DAB9FF]" />
              <span>{ticket.statusWOInstaller}</span>
            </span>
          )}
          {!isLiveProgress && <StatusInstallerBadge status={ticket.statusWOInstaller} />}
        </div>
      </div>

      {/* Metadata Badges Strip */}
      <div
        className={`flex flex-wrap items-center gap-1.5 ${
          androidConfig.highContrastBadges ? 'saturate-110' : 'opacity-90'
        }`}
      >
        {ticket.approvalStatus && ticket.approvalStatus !== 'NONE' && (
          <StatusApprovalBadge status={ticket.approvalStatus} />
        )}
        <StatusWhatsAppBadge status={ticket.statusWhatsApp} />
        <StatusAgentBadge status={ticket.statusWOAgent} />
        {ticketClosed && ticket.statusWOAgent !== 'Closed' && (
          <span className="px-2 py-0.5 rounded bg-[#26364A] dark:bg-[#E8DDFF] text-white dark:text-[#1F1638] text-[10px] font-bold">
            Ticket: Closed
          </span>
        )}
        {ticket.area && (
          <span className="px-2 py-0.5 rounded bg-[#EDF3F8] dark:bg-[#160D29] text-[#52647A] dark:text-[#CEC0E8] border border-[#DDE6F0] dark:border-[#4B386B] text-[10px] font-semibold">
            {ticket.area}
          </span>
        )}
      </div>

      {/* Compact Phone / WhatsApp & LiveChat Bar */}
      {showQuickBar && (
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E]">
          <div className="flex items-center gap-1.5 min-w-0">
            {phoneStr ? (
              <>
                {androidConfig.showQuickCall && (
                  <a
                    href={`tel:${phoneStr}`}
                    onClick={e => e.stopPropagation()}
                    className="btn-3d-ceramic inline-flex items-center gap-1 px-2.5 min-h-[38px] rounded-lg text-[11px] font-mono font-semibold truncate"
                    title={`Telepon ${phoneStr}`}
                  >
                    <Phone className="w-3 h-3 text-[#218A63] dark:text-emerald-600 shrink-0" />
                    <span className="truncate">{phoneStr}</span>
                  </a>
                )}
                {androidConfig.showQuickWhatsApp && (
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      onOpenWhatsApp(ticket);
                    }}
                    className="btn-3d-emerald inline-flex items-center gap-1 px-2.5 min-h-[38px] rounded-lg text-[11px] font-bold cursor-pointer shrink-0"
                    title="Buka WhatsApp Pelanggan"
                  >
                    <MessageSquare className="w-3 h-3" />
                    <span>WA</span>
                  </button>
                )}
                {!androidConfig.showQuickCall && !androidConfig.showQuickWhatsApp && (
                  <span className="text-[11px] font-mono text-[#52647A] dark:text-[#CEC0E8] truncate">
                    {phoneStr}
                  </span>
                )}
              </>
            ) : (
              <span className="text-[11px] text-[#8492A5] dark:text-[#C5B3DF] italic">Tanpa nomor kontak</span>
            )}
          </div>

          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              onSelectTicket(ticket, 'chat');
            }}
            className={`inline-flex items-center gap-1.5 px-3 min-h-[38px] rounded-lg text-[11px] font-bold cursor-pointer shrink-0 ${
              unread > 0
                ? 'bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-950/70 dark:border-rose-800 dark:text-rose-200'
                : 'btn-3d-lilac'
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
      )}

      {/* Thumb-Zone Bottom CTA Row (Lihat Detail) */}
      {androidConfig.showQuickDetail && (
        <div className="grid grid-cols-1 gap-2 pt-1">
          <button
            type="button"
            onClick={() => onSelectTicket(ticket, 'overview')}
            className={`btn-3d-lilac flex items-center justify-center gap-1.5 px-3 rounded-xl font-bold cursor-pointer ${
              isComfortableTouch ? 'min-h-[44px] text-xs' : 'min-h-[40px] text-[11px]'
            }`}
          >
            <Eye className="w-4 h-4 shrink-0" />
            <span>Lihat Detail</span>
          </button>
        </div>
      )}
    </article>
  );
};
