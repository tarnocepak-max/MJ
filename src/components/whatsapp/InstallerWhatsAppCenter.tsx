import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Ticket } from '../../types/index.ts';
import { StatusInstallerBadge, StatusWhatsAppBadge } from '../common/Badge';
import {
  MessageSquare,
  Search,
  Phone,
  Send,
  Calendar,
  MapPin,
  CheckCircle2,
  Clock,
  RotateCcw,
  ExternalLink,
  Wrench,
  AlertCircle,
  Copy,
  Check
} from 'lucide-react';
import { normalizePhoneNumber, buildWhatsAppClickToChatUrl, renderWhatsAppMessage } from '../../services/whatsappService';
import { useToast } from '../../context/ToastContext';

interface InstallerWhatsAppCenterProps {
  onOpenWhatsAppModal: (ticket: Ticket) => void;
  onSelectTicket: (ticket: Ticket) => void;
}

export const InstallerWhatsAppCenter: React.FC<InstallerWhatsAppCenterProps> = ({
  onOpenWhatsAppModal,
  onSelectTicket
}) => {
  const { currentUser, tickets, templates } = useApp();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unconfirmed' | 'confirmed' | 'reschedule'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Helper matching for logged-in technician
  const isInstallerMatch = (ticketInstaller: string | undefined, installerName: string) => {
    if (!ticketInstaller || !ticketInstaller.trim()) return false;
    const tInst = ticketInstaller.toLowerCase().trim();
    const effInst = installerName.toLowerCase().trim();
    if (tInst === effInst) return true;
    if (tInst.includes(effInst) || effInst.includes(tInst)) return true;
    const cleanEff = effInst.replace(/\(.*?\)/g, '').trim();
    if (cleanEff && (tInst.includes(cleanEff) || cleanEff.includes(tInst))) return true;
    return false;
  };

  // Strictly tickets assigned to current installer
  const myTickets = useMemo(() => {
    const myName = currentUser.name || '';
    const myUsername = currentUser.username || '';
    const myId = currentUser.id || '';

    return (tickets || []).filter(t => {
      if (t.isArchived || t.isDeleted) return false;
      if (!t.installerName) return false;

      if (t.assignedTo && (t.assignedTo === myId || t.assignedTo === myUsername)) return true;
      if (myName && isInstallerMatch(t.installerName, myName)) return true;
      if (myUsername && isInstallerMatch(t.installerName, myUsername)) return true;

      return false;
    });
  }, [tickets, currentUser]);

  const filteredTickets = useMemo(() => {
    return myTickets.filter(t => {
      if (statusFilter === 'unconfirmed') {
        if (t.statusWhatsApp === 'confirmed') return false;
      } else if (statusFilter === 'confirmed') {
        if (t.statusWhatsApp !== 'confirmed') return false;
      } else if (statusFilter === 'reschedule') {
        if (t.statusWhatsApp !== 'reschedule_requested') return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchWO = (t.woNumber || '').toLowerCase().includes(q);
        const matchCust = (t.customerName || '').toLowerCase().includes(q);
        const matchPhone = (t.customerPhone || '').includes(q);
        const matchArea = (t.area || '').toLowerCase().includes(q);
        const matchStreet = (t.streetName || '').toLowerCase().includes(q);
        return matchWO || matchCust || matchPhone || matchArea || matchStreet;
      }

      return true;
    });
  }, [myTickets, statusFilter, searchQuery]);

  const handleDirectWA = (ticket: Ticket) => {
    const defaultTpl = templates.find(tpl => tpl.isDefault) || templates[0];
    const templateBody = defaultTpl ? defaultTpl.messageBody : 'Halo {{customer_name}}, kami dari teknisi {{contractor_name}} konfirmasi kedatangan untuk WO {{wo_number}}.';
    const { renderedText } = renderWhatsAppMessage(templateBody, ticket);
    const { url } = buildWhatsAppClickToChatUrl(ticket.customerPhone, renderedText);

    if (url) {
      window.open(url, '_blank');
    } else {
      onOpenWhatsAppModal(ticket);
    }
  };

  const handleCopyPhone = (e: React.MouseEvent, phone: string, ticketId: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(normalizePhoneNumber(phone));
    setCopiedId(ticketId);
    toast.success('Nomor WhatsApp disalin!');
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="max-w-lg lg:max-w-5xl mx-auto space-y-4">
      {/* Top Banner */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0B1220] border border-slate-700/80 text-white p-4 sm:p-5 shadow-sm relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#16A36A]/20 flex items-center justify-center shrink-0 border border-emerald-500/30">
              <MessageSquare className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="font-display text-base sm:text-lg font-extrabold tracking-tight text-white">
                Pusat WhatsApp Pelanggan
              </h2>
              <p className="text-xs text-slate-300 mt-0.5">
                Konfirmasi jadwal, pesan template resmi, dan notifikasi teknisi menuju lokasi.
              </p>
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-full bg-white/10 text-xs font-bold text-[#38BDF8] shrink-0 self-start sm:self-auto border border-slate-700 tabular-nums">
            {myTickets.length} Tiket Pelanggan
          </div>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Status Buttons (horizontal scroll on mobile) */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-bold transition-all cursor-pointer tabular-nums shrink-0 whitespace-nowrap ${
                statusFilter === 'all'
                  ? 'bg-[#2563EB] text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-[#1E293B] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Semua ({myTickets.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('unconfirmed')}
              className={`px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 whitespace-nowrap ${
                statusFilter === 'unconfirmed'
                  ? 'bg-[#D97706] text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-[#1E293B] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Perlu Konfirmasi
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('confirmed')}
              className={`px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 whitespace-nowrap ${
                statusFilter === 'confirmed'
                  ? 'bg-[#16A36A] text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-[#1E293B] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Terkonfirmasi
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('reschedule')}
              className={`px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 whitespace-nowrap ${
                statusFilter === 'reschedule'
                  ? 'bg-[#2563EB] text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-[#1E293B] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Reschedule
            </button>
          </div>

          {/* Search */}
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Cari nama, WO, atau telp..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-3 py-2.5 min-h-[44px] text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
          </div>
        </div>
      </div>

      {/* Ticket List for WhatsApp */}
      {filteredTickets.length === 0 ? (
        <div className="p-8 text-center rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 space-y-2">
          <MessageSquare className="w-10 h-10 text-slate-400 mx-auto" />
          <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            Tidak Ada Work Order yang Cocok
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Tidak ditemukan tiket pelanggan sesuai filter yang dipilih.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filteredTickets.map(ticket => (
            <div
              key={ticket.id}
              className="bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between gap-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-extrabold text-[#2563EB] dark:text-[#38BDF8]">
                      {ticket.woNumber || ticket.ticketNumber || 'WO-Unknown'}
                    </span>
                    <StatusWhatsAppBadge status={ticket.statusWhatsApp} />
                  </div>
                  <h3 className="font-display font-bold text-sm text-slate-900 dark:text-white mt-1">
                    {ticket.customerName || 'Nama Pelanggan'}
                  </h3>
                  <div className="flex items-center gap-2 text-xs font-medium text-[#16A36A] dark:text-emerald-400 mt-0.5 tabular-nums">
                    <Phone className="w-3.5 h-3.5" />
                    <span>{ticket.customerPhone || 'Tidak ada nomor telepon'}</span>
                    {ticket.customerPhone && (
                      <button
                        type="button"
                        onClick={(e) => handleCopyPhone(e, ticket.customerPhone, ticket.id)}
                        className="text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 cursor-pointer p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg"
                        title="Salin nomor"
                      >
                        {copiedId === ticket.id ? <Check className="w-3.5 h-3.5 text-[#16A36A]" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>

                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 dark:bg-[#1E293B] text-[#2563EB] dark:text-[#38BDF8] border border-blue-100 dark:border-slate-700 shrink-0 tabular-nums">
                  {ticket.slotTime || 'Hari ini'}
                </span>
              </div>

              <div className="text-xs text-slate-600 dark:text-slate-300 flex items-start gap-1.5 bg-slate-50 dark:bg-[#1E293B] p-2.5 rounded-xl border border-slate-200 dark:border-slate-700">
                <MapPin className="w-3.5 h-3.5 text-[#2563EB] dark:text-[#38BDF8] shrink-0 mt-0.5" />
                <span className="line-clamp-2">
                  {ticket.streetName || ticket.clusterName || ticket.area || 'Alamat tidak tersedia'}
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => onSelectTicket(ticket)}
                  className="px-3 py-2 min-h-[44px] rounded-xl text-xs font-bold text-[#2563EB] dark:text-[#38BDF8] hover:bg-blue-50 dark:hover:bg-[#1E293B] cursor-pointer transition-colors"
                >
                  Lihat Detail WO
                </button>

                <div className="flex items-center gap-1.5 ml-auto">
                  <button
                    type="button"
                    onClick={() => onOpenWhatsAppModal(ticket)}
                    className="px-3 py-2 min-h-[44px] rounded-xl bg-slate-100 dark:bg-[#1E293B] hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-white transition-all cursor-pointer whitespace-nowrap"
                  >
                    Pilih Template
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDirectWA(ticket)}
                    className="flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-xl bg-[#16A36A] hover:bg-[#15803D] text-white text-xs font-bold shadow-xs active:scale-95 transition-all cursor-pointer whitespace-nowrap"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Kirim WA</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
