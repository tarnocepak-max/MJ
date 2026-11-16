import React from 'react';
import { Ticket } from '../../types/index.ts';
import { useUIConfig } from '../../context/UIConfigContext';
import { useApp } from '../../context/AppContext';
import { StatusAgentBadge, StatusInstallerBadge, StatusWhatsAppBadge, StatusApprovalBadge } from '../common/Badge';
import {
  MessageSquare,
  MessageCircle,
  Eye,
  Phone,
  Clock,
  MapPin,
  User,
  Wrench,
  CheckSquare,
  Square,
  Calendar,
  Layers,
  ExternalLink
} from 'lucide-react';
import { openCustomerAddressInGoogleMaps } from '../../services/mapsService';

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
  const { currentUser, getTicketUnreadCount } = useApp();
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
      ? 'p-2.5 gap-2'
      : 'p-3.5 gap-2.5';

  return (
    <div
      className={`mj-tactile-card border transition-all duration-150 flex flex-col relative overflow-hidden ${
        isSelected
          ? 'border-[#7135B5] ring-2 ring-[#7135B5]/25 bg-[#F8F1FF] dark:bg-[#2E1459]'
          : 'border-[#e8ddff] dark:border-[#3b1d78] hover:border-[#cec3d4] dark:hover:border-[#5B35B1]'
      } ${densityPadding}`}
    >
      {/* Top Bar: Checkbox + WO Number + Slot Time Badge */}
      <div className="flex items-center justify-between gap-2 border-b border-[#E9E5F0] dark:border-[#35105E] pb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => onToggleSelect(ticket.id)}
            className="p-1 -m-1 text-[#8B8495] hover:text-[#431599] focus:outline-none min-w-[36px] min-h-[36px] flex items-center justify-center shrink-0 cursor-pointer"
            aria-label="Select ticket"
          >
            {isSelected ? (
              <CheckSquare className="w-5 h-5 text-[#431599] dark:text-[#A78BFA]" />
            ) : (
              <Square className="w-5 h-5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onSelectTicket(ticket)}
            className="text-left font-mono font-bold text-sm text-[#431599] dark:text-[#D8B4FE] hover:underline truncate tabular-nums cursor-pointer"
            title="Buka Detail Tiket"
          >
            {ticket.woNumber}
          </button>
        </div>

        {/* Slot Time & Category */}
        <div className="flex items-center gap-1.5 shrink-0">
          {ticket.slotTime && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#F4EAFF] dark:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE] border border-[#D8CCF3] dark:border-[#5B35B1] text-[11px] font-mono font-semibold tabular-nums">
              <Clock className="w-3 h-3" />
              <span>{ticket.slotTime}</span>
            </span>
          )}
          {ticket.ticketCategory && (
            <span className="px-1.5 py-0.5 rounded bg-[#F7F6FA] dark:bg-[#160D29] text-[#766B83] dark:text-[#CEC0E8] border border-[#E9E5F0] dark:border-[#35105E] text-[10px] font-bold uppercase">
              {ticket.ticketCategory}
            </span>
          )}
        </div>
      </div>

      {/* Customer & Location Details */}
      <div className="flex flex-col gap-2 text-xs">
        {/* Customer Information Section */}
        <div className="mj-tactile-well p-2.5 border border-[#e8ddff] dark:border-[#35105E] space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 font-bold text-[#211A2E] dark:text-white text-sm">
                <User className="w-3.5 h-3.5 text-[#8B8495] shrink-0" />
                <span className="truncate">{ticket.customerName}</span>
              </div>
              <p className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] truncate ml-5">
                Customer ID:{' '}
                <span className="font-mono font-semibold text-[#211A2E] dark:text-[#F5F1FF] tabular-nums">
                  {ticket.idCustomer}
                </span>
              </p>
            </div>

            {ticket.area && currentUser?.role !== 'super_admin' && currentUser?.role !== 'dispatch' && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#F4EAFF] dark:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE] text-[11px] shrink-0 font-semibold border border-[#D8CCF3] dark:border-[#5B35B1]">
                <MapPin className="w-3 h-3 text-[#7135B5] dark:text-[#A78BFA]" />
                <span>{ticket.area}</span>
              </div>
            )}
          </div>

          {/* Nomor Telepon [Tombol WhatsApp] Right Beside */}
          <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[#E9E5F0] dark:border-[#35105E]">
            <div className="flex items-center gap-1.5 font-mono text-[#211A2E] dark:text-[#F5F1FF] tabular-nums">
              <Phone className="w-3.5 h-3.5 text-[#16A36A] shrink-0" />
              <span className="font-semibold">{ticket.customerPhone || 'Tidak ada nomor'}</span>
            </div>

            {ticket.customerPhone && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenWhatsApp(ticket);
                }}
                className="mj-tactile-btn-success px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 shrink-0 cursor-pointer whitespace-nowrap"
                title="Buka WhatsApp Pelanggan"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>WhatsApp</span>
              </button>
            )}
          </div>
        </div>

        {/* Address & Location with Google Maps Interactive Click */}
        {(ticket.streetName || ticket.clusterName || ticket.area) && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              openCustomerAddressInGoogleMaps(ticket);
            }}
            className="mj-tactile-well group cursor-pointer p-2.5 border border-[#d8ccf3] dark:border-[#3B1D78] hover:bg-[#f3eaff] dark:hover:bg-[#35105E] transition-all"
            title="Klik alamat untuk membuka Google Maps"
          >
            <div className="flex items-start justify-between gap-1.5">
              <div className="flex items-start gap-1.5 min-w-0 flex-1">
                <MapPin className="w-3.5 h-3.5 text-[#431599] dark:text-[#A78BFA] shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#766B83] dark:text-[#D8CCF3]">
                    Alamat & Lokasi
                  </div>
                  <div className="font-bold text-[#431599] dark:text-[#E9E1FF] text-[11.5px] truncate mt-0.5">
                    {ticket.clusterName ? `[${ticket.clusterName}] ` : ''}{ticket.streetName || ticket.area || 'Alamat Pelanggan'}
                  </div>
                  {ticket.streetAlternatif && (
                    <div className="text-[10.5px] text-[#766B83] dark:text-[#D8CCF3] truncate mt-0.5">
                      Patokan: {ticket.streetAlternatif}
                    </div>
                  )}
                </div>
              </div>
              <span className="text-[10px] text-[#431599] dark:text-[#E9E1FF] font-bold bg-white/90 dark:bg-[#160D29] px-2 py-0.5 rounded-md border border-[#D8CCF3] dark:border-[#5B35B1] shrink-0 flex items-center gap-1 shadow-2xs">
                <span>Maps</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </span>
            </div>
            <div className="text-[9.5px] text-[#7135B5] dark:text-[#D8CCF3] font-medium mt-1 pl-5">
              Klik alamat untuk membuka Google Maps ↗
            </div>
          </div>
        )}

        {/* Appointment Date & Slot Time Schedule */}
        <div className="flex items-center justify-between text-xs pt-1">
          <div className="flex items-center gap-1.5 text-[#766B83] dark:text-[#CEC0E8]">
            <Calendar className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#A78BFA] shrink-0" />
            <span className="text-[11px]">Appointment Date:</span>
            <span className="font-mono font-bold text-[#211A2E] dark:text-white tabular-nums">
              {ticket.appointmentDate || 'Tanggal Belum Ada'}
            </span>
          </div>
          {ticket.slotTime && (
            <span className="font-mono text-[11px] font-semibold text-[#431599] dark:text-[#D8B4FE] tabular-nums">
              {ticket.slotTime}
            </span>
          )}
        </div>

        {/* Assigned Installer Info */}
        <div className="flex items-center justify-between text-xs pt-1">
          <div className="flex items-center gap-1.5 text-[#766B83] dark:text-[#CEC0E8]">
            <Wrench className="w-3.5 h-3.5 text-[#8B8495]" />
            <span className="text-[11px]">Teknisi:</span>
            {ticket.installerName ? (
              <span className="font-semibold text-[#211A2E] dark:text-white">{ticket.installerName}</span>
            ) : (
              <span className="text-[#E59A27] dark:text-amber-400 font-semibold italic text-[11px]">
                Belum Ditugaskan
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 text-[11px] text-[#8B8495] font-mono tabular-nums">
            <Calendar className="w-3 h-3" />
            <span>{ticket.date}</span>
          </div>
        </div>

        {/* Status Badges Group */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <StatusApprovalBadge status={ticket.approvalStatus} />
          <StatusWhatsAppBadge status={ticket.statusWhatsApp} />
          <StatusInstallerBadge status={ticket.statusWOInstaller} />
          <StatusAgentBadge status={ticket.statusWOAgent} />
        </div>
      </div>

      {/* Bottom Action Dock */}
      <div className="grid grid-cols-2 gap-2 pt-2.5 border-t border-[#e8ddff] dark:border-[#35105E] mt-1">
        {/* Chat Action with Unread Badge */}
        {(() => {
          const unread = getTicketUnreadCount(ticket.id);
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectTicket(ticket, 'chat');
              }}
              className={`flex items-center justify-center gap-1.5 px-3 rounded-xl font-bold border transition-all cursor-pointer whitespace-nowrap ${
                unread > 0
                  ? 'bg-[#FEF2F2] dark:bg-rose-950/50 text-[#ba1a1a] dark:text-rose-300 border-[#FECACA] dark:border-rose-900 shadow-[0_3px_0_#fecaca]'
                  : 'mj-tactile-btn-secondary border-[#cec3d4] dark:border-[#4b386b]'
              } ${isComfortableTouch ? 'py-2.5 text-xs min-h-[44px]' : 'py-1.5 text-[11px] min-h-[40px]'}`}
              title={unread > 0 ? `${unread} Chat Belum Dibaca` : 'Buka Live Chat'}
            >
              <MessageCircle className="w-4 h-4 shrink-0 text-[#58149c] dark:text-[#dab9ff]" />
              <span>Chat</span>
              {unread > 0 && (
                <span className="px-1.5 py-0.2 bg-[#ba1a1a] text-white text-[10px] font-bold rounded-full tabular-nums">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
          );
        })()}

        {/* Call Customer Direct Action (Phone Call) */}
        {ticket.customerPhone ? (
          <a
            href={`tel:${ticket.customerPhone}`}
            onClick={(e) => e.stopPropagation()}
            className={`mj-tactile-btn-secondary flex items-center justify-center gap-1.5 px-3 rounded-xl border border-[#cec3d4] dark:border-[#4b386b] cursor-pointer whitespace-nowrap ${
              isComfortableTouch ? 'py-2.5 text-xs min-h-[44px]' : 'py-1.5 text-[11px] min-h-[40px]'
            }`}
            title={`Telepon ${ticket.customerPhone}`}
          >
            <Phone className="w-4 h-4 text-[#16A36A] dark:text-emerald-400 shrink-0" />
            <span>Panggil</span>
          </a>
        ) : (
          <div className="mj-tactile-well flex items-center justify-center text-[#7d7484] text-xs py-2 rounded-xl min-h-[44px]">
            Telepon -
          </div>
        )}

        {/* View / Edit Detail Action */}
        <button
          type="button"
          onClick={() => onSelectTicket(ticket, 'overview')}
          className={`mj-tactile-btn-primary col-span-2 flex items-center justify-center gap-1.5 rounded-xl cursor-pointer whitespace-nowrap ${
            isComfortableTouch ? 'py-2.5 text-xs min-h-[44px]' : 'py-2 text-[11px] min-h-[40px]'
          }`}
          title="Buka Detail & Penugasan WO"
        >
          <Eye className="w-4 h-4 shrink-0" />
          <span>Detail WO</span>
        </button>
      </div>
    </div>
  );
};
