import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { useToast } from '../../context/ToastContext';
import { Ticket } from '../../types/index.ts';
import { StatusWhatsAppBadge } from '../common/Badge';
import {
  MessageSquare,
  Search,
  Phone,
  Send,
  MapPin,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  Wifi,
  WifiOff,
  FileText,
  Zap,
  Eye,
  X
} from 'lucide-react';
import {
  normalizePhoneNumber,
  buildWhatsAppClickToChatUrl,
  renderWhatsAppMessage
} from '../../services/whatsappService';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';

interface InstallerWhatsAppCenterProps {
  onOpenWhatsAppModal: (ticket: Ticket) => void;
  onSelectTicket: (ticket: Ticket) => void;
}

const FALLBACK_QUICK_TEMPLATES = [
  {
    id: 'tpl_otw',
    shortLabel: 'Template A · Konfirmasi Keberangkatan',
    messageBody:
      'Halo {{customer_name}}, saya {{installer_name}} teknisi {{contractor_name}} untuk WO {{wo_number}}. Saat ini saya sedang bersiap menuju lokasi Anda sesuai jadwal {{slot_time}}. Mohon pastikan ada penerima di lokasi.'
  },
  {
    id: 'tpl_eta',
    shortLabel: 'Template B · Estimasi Tiba (ETA 20 Mnt)',
    messageBody:
      'Halo {{customer_name}}, teknisi {{installer_name}} ({{contractor_name}}) menginfokan estimasi tiba di alamat Anda sekitar 20 menit lagi untuk pemasangan WO {{wo_number}}. Terima kasih.'
  },
  {
    id: 'tpl_shareloc',
    shortLabel: 'Template C · Permintaan Share Location',
    messageBody:
      'Halo {{customer_name}}, saya {{installer_name}} teknisi {{contractor_name}} (WO {{wo_number}}). Mohon kirimkan share live location via WhatsApp agar tim kami lebih mudah menemukan titik rumah Anda. Terima kasih.'
  }
];

export const InstallerWhatsAppCenter: React.FC<InstallerWhatsAppCenterProps> = ({
  onOpenWhatsAppModal,
  onSelectTicket
}) => {
  const { currentUser, tickets, templates, todayWIB } = useApp();
  const { isOnline } = useOfflineSync();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unconfirmed' | 'confirmed' | 'reschedule'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedQuickTplByTicket, setSelectedQuickTplByTicket] = useState<Record<string, string>>({});

  // Official SOP template preview state
  const [selectedSopTemplateId, setSelectedSopTemplateId] = useState<string>('');
  const [selectedPreviewTicketId, setSelectedPreviewTicketId] = useState<string>('');

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

  // Strictly customer contacts from current installer's assigned WOs scheduled for today (Jakarta date)
  const myTickets = useMemo(() => {
    const myName = currentUser.name || '';
    const myUsername = currentUser.username || '';
    const myId = currentUser.id || '';

    return (tickets || []).filter(t => {
      if (t.isArchived || t.isDeleted) return false;
      if (!t.installerName && !t.assignedTo && !t.installerId) return false;
      if (getTicketAppointmentDate(t) !== todayWIB) return false;

      if (t.assignedTo && (t.assignedTo === myId || t.assignedTo === myUsername)) return true;
      if (myName && isInstallerMatch(t.installerName, myName)) return true;
      if (myUsername && isInstallerMatch(t.installerName, myUsername)) return true;

      return false;
    });
  }, [tickets, currentUser, todayWIB]);

  const counts = useMemo(() => {
    const confirmed = myTickets.filter(t => t.statusWhatsApp === 'confirmed').length;
    const reschedule = myTickets.filter(t => t.statusWhatsApp === 'reschedule_requested').length;
    const unconfirmed = myTickets.filter(t => t.statusWhatsApp !== 'confirmed').length;
    return {
      total: myTickets.length,
      confirmed,
      reschedule,
      unconfirmed
    };
  }, [myTickets]);

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
        const matchStreet = (t.streetName || t.address || '').toLowerCase().includes(q);
        return matchWO || matchCust || matchPhone || matchArea || matchStreet;
      }

      return true;
    });
  }, [myTickets, statusFilter, searchQuery]);

  // Quick A/B/C options sourced from AppContext templates when available, with standard SOP fallback
  const quickTemplateChoices = useMemo(() => {
    const activeTemplates = (templates || []).filter(tpl => tpl.active !== false);
    if (activeTemplates.length >= 3) {
      return activeTemplates.slice(0, 3).map((tpl, idx) => ({
        id: tpl.id,
        shortLabel: `Template ${['A', 'B', 'C'][idx]} · ${tpl.name}`,
        messageBody: tpl.messageBody
      }));
    }
    if (activeTemplates.length > 0) {
      const merged = [
        ...activeTemplates.map((tpl, idx) => ({
          id: tpl.id,
          shortLabel: `Template ${['A', 'B', 'C'][idx]} · ${tpl.name}`,
          messageBody: tpl.messageBody
        })),
        ...FALLBACK_QUICK_TEMPLATES
      ].slice(0, 3);
      return merged;
    }
    return FALLBACK_QUICK_TEMPLATES;
  }, [templates]);

  // All SOP templates available in bottom preview card
  const sopTemplateOptions = useMemo(() => {
    const activeTemplates = (templates || []).filter(tpl => tpl.active !== false);
    if (activeTemplates.length > 0) {
      return activeTemplates.map((tpl, i) => ({
        id: tpl.id,
        label: `SOP-${String(i + 1).padStart(2, '0')}: ${tpl.name}`,
        messageBody: tpl.messageBody
      }));
    }
    return FALLBACK_QUICK_TEMPLATES.map((tpl, i) => ({
      id: tpl.id,
      label: `SOP-${String(i + 1).padStart(2, '0')}: ${tpl.shortLabel}`,
      messageBody: tpl.messageBody
    }));
  }, [templates]);

  useEffect(() => {
    if (!selectedSopTemplateId && sopTemplateOptions.length > 0) {
      setSelectedSopTemplateId(sopTemplateOptions[0].id);
    }
  }, [sopTemplateOptions, selectedSopTemplateId]);

  useEffect(() => {
    if (myTickets.length === 0) {
      if (selectedPreviewTicketId) setSelectedPreviewTicketId('');
      return;
    }
    const stillValid = myTickets.some(t => t.id === selectedPreviewTicketId);
    if (!selectedPreviewTicketId || !stillValid) {
      const priorityTicket = myTickets.find(t => t.statusWhatsApp !== 'confirmed') || myTickets[0];
      setSelectedPreviewTicketId(priorityTicket.id);
    }
  }, [myTickets, selectedPreviewTicketId]);

  const activeSopTemplate = useMemo(
    () => sopTemplateOptions.find(t => t.id === selectedSopTemplateId) || sopTemplateOptions[0],
    [sopTemplateOptions, selectedSopTemplateId]
  );

  const activePreviewTicket = useMemo(
    () => myTickets.find(t => t.id === selectedPreviewTicketId) || myTickets[0] || null,
    [myTickets, selectedPreviewTicketId]
  );

  const renderedSopPreview = useMemo(() => {
    if (!activeSopTemplate || !activePreviewTicket) {
      return activeSopTemplate?.messageBody || '';
    }
    return renderWhatsAppMessage(activeSopTemplate.messageBody, activePreviewTicket).renderedText;
  }, [activeSopTemplate, activePreviewTicket]);

  const sendRenderedWhatsApp = (ticket: Ticket, bodyText: string) => {
    const { renderedText } = renderWhatsAppMessage(bodyText, ticket);
    const { url, error } = buildWhatsAppClickToChatUrl(ticket.customerPhone, renderedText);

    if (url) {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      toast.warning(error || 'Nomor telepon belum valid. Membuka editor pesan...', 'WhatsApp');
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
    <div className="max-w-lg lg:max-w-5xl mx-auto space-y-4 pb-24 sm:pb-8">
      {/* =============================================================== */}
      {/* 1. MORAJAWS DARK PURPLE / MAROON WHATSAPP GATEWAY HEADER        */}
      {/* =============================================================== */}
      <section className="rounded-2xl bg-gradient-to-br from-[#160D29] via-[#2D115B] to-[#480123] border border-[#58149C]/60 text-white p-4 sm:p-5 shadow-md space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0 border border-emerald-400/40">
              <MessageSquare className="w-5 h-5 text-emerald-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[10px] font-extrabold uppercase tracking-wider text-[#DAB9FF]">
                  KONFIRMASI PELANGGAN
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-mono font-bold border ${
                    isOnline
                      ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40'
                      : 'bg-amber-500/20 text-amber-200 border-amber-400/40'
                  }`}
                >
                  {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                  <span>{isOnline ? 'SIAP KIRIM · ONLINE' : 'OFFLINE'}</span>
                </span>
              </div>
              <h2 className="font-display text-base sm:text-lg font-extrabold tracking-tight text-white mt-0.5 truncate">
                WhatsApp Gateway Teknisi
              </h2>
            </div>
          </div>

          <span className="px-3 py-1 rounded-full bg-white/10 border border-white/15 text-xs font-mono font-bold text-[#EEDBFF] shrink-0 self-start sm:self-auto tabular-nums">
            {currentUser.name}
          </span>
        </div>

        {/* 3 Real Operational Counters */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-xl bg-white/10 backdrop-blur-xs border border-white/15 px-3 py-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#DAB9FF] block truncate">
              Total Pelanggan
            </span>
            <span className="font-display text-xl font-extrabold text-white tabular-nums mt-0.5 block">
              {counts.total}
            </span>
          </div>
          <div className="rounded-xl bg-white/10 backdrop-blur-xs border border-emerald-400/25 px-3 py-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-200 block truncate">
              Terkonfirmasi
            </span>
            <span className="font-display text-xl font-extrabold text-emerald-300 tabular-nums mt-0.5 block">
              {counts.confirmed}
            </span>
          </div>
          <div className="rounded-xl bg-white/10 backdrop-blur-xs border border-amber-400/25 px-3 py-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-200 block truncate">
              Perlu Konfirmasi
            </span>
            <span className="font-display text-xl font-extrabold text-amber-300 tabular-nums mt-0.5 block">
              {counts.unconfirmed}
            </span>
          </div>
        </div>
      </section>

      {/* =============================================================== */}
      {/* 2. FILTER TABS & DEBOSSED SEARCH BAR                            */}
      {/* =============================================================== */}
      <section className="card-3d-lavender rounded-2xl p-3.5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {[
              { key: 'all' as const, label: `Semua (${counts.total})` },
              { key: 'unconfirmed' as const, label: `Perlu Konfirmasi (${counts.unconfirmed})` },
              { key: 'confirmed' as const, label: `Terkonfirmasi (${counts.confirmed})` },
              { key: 'reschedule' as const, label: `Reschedule (${counts.reschedule})` }
            ].map(tab => {
              const isActive = statusFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatusFilter(tab.key)}
                  className={`px-3 py-1.5 text-xs font-bold cursor-pointer tabular-nums shrink-0 whitespace-nowrap ${
                    isActive
                      ? 'mj-btn-installer-secondary mj-btn-compact'
                      : 'mj-btn-installer-neutral mj-btn-compact'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="relative flex-1 sm:max-w-xs">
            <Search className="w-4 h-4 text-[#7d7484] dark:text-[#A79BC0] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Cari nama, WO, atau telp..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="tactile-debossed-input w-full pl-10 pr-8 py-2 min-h-[42px] text-xs rounded-xl border border-[#e8ddff] dark:border-[#35105E] bg-[#f8f1ff] dark:bg-[#160D29] text-[#1f1638] dark:text-[#f5eeff] placeholder:text-[#7d7484] dark:placeholder:text-[#A79BC0] focus:outline-none focus:ring-2 focus:ring-[#7135B5]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Hapus pencarian"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7d7484] hover:text-[#1f1638] dark:hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* =============================================================== */}
      {/* 3. DAFTAR ANTREAN CHAT PELANGGAN + QUICK TEMPLATE A/B/C         */}
      {/* =============================================================== */}
      {filteredTickets.length === 0 ? (
        <div className="card-3d-lavender p-8 text-center rounded-2xl space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-[#f3eaff] dark:bg-[#2A194B] text-[#58149C] dark:text-[#DAB9FF] mx-auto flex items-center justify-center border border-[#e8ddff] dark:border-[#4B386B]">
            <MessageSquare className="w-6 h-6" />
          </div>
          <h4 className="font-display text-sm font-bold text-[#1f1638] dark:text-[#f5eeff]">
            {myTickets.length === 0
              ? 'Tidak ada kontak WhatsApp dari tugas WO hari ini.'
              : 'Tidak Ada Kontak Pelanggan yang Cocok'}
          </h4>
          <p className="text-xs text-[#4b4452] dark:text-[#C4B5D6]">
            {myTickets.length === 0
              ? 'Hanya pelanggan dari Work Order yang ditugaskan kepada Anda pada tanggal hari ini yang akan muncul di sini.'
              : 'Tidak ditemukan kontak WhatsApp pelanggan sesuai kata kunci atau filter status hari ini.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filteredTickets.map(ticket => {
            const isConfirmed = ticket.statusWhatsApp === 'confirmed';
            const selectedQuickId =
              selectedQuickTplByTicket[ticket.id] || quickTemplateChoices[0]?.id || '';
            const selectedQuickObj =
              quickTemplateChoices.find(c => c.id === selectedQuickId) || quickTemplateChoices[0];
            const renderedQuickPreview = selectedQuickObj
              ? renderWhatsAppMessage(selectedQuickObj.messageBody, ticket).renderedText
              : '';

            return (
              <article
                key={ticket.id}
                className="card-3d-lavender rounded-2xl p-4 flex flex-col justify-between gap-3"
              >
                {/* Header: WO + Slot + WA Status */}
                <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-[#e8ddff] dark:border-[#35105E]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-xs font-extrabold text-[#58149C] dark:text-[#DAB9FF]">
                        {ticket.woNumber || ticket.ticketNumber || 'WO-Unknown'}
                      </span>
                      <StatusWhatsAppBadge status={ticket.statusWhatsApp} />
                    </div>
                    <h3 className="font-display font-bold text-sm sm:text-[15px] text-[#1f1638] dark:text-[#f5eeff] mt-1 truncate">
                      {ticket.customerName || 'Nama Pelanggan'}
                    </h3>
                    <div className="flex items-center gap-1.5 text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-400 mt-0.5 tabular-nums">
                      <Phone className="w-3.5 h-3.5 shrink-0" />
                      <span>{ticket.customerPhone || 'Tidak ada nomor telepon'}</span>
                      {ticket.customerPhone && (
                        <button
                          type="button"
                          onClick={e => handleCopyPhone(e, ticket.customerPhone, ticket.id)}
                          className="text-[#7d7484] hover:text-[#1f1638] dark:hover:text-white cursor-pointer p-1 rounded-md"
                          title="Salin nomor"
                        >
                          {copiedId === ticket.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#f3eaff] dark:bg-[#2A194B] text-[#58149C] dark:text-[#DAB9FF] border border-[#e8ddff] dark:border-[#4B386B] shrink-0 tabular-nums">
                    {ticket.slotTime || 'Hari ini'}
                  </span>
                </div>

                {/* Address Inset Well */}
                <div className="text-xs text-[#4b4452] dark:text-[#C4B5D6] flex items-start gap-1.5 bg-[#f8f1ff] dark:bg-[#160D29] p-2.5 rounded-xl border border-[#e8ddff] dark:border-[#35105E]">
                  <MapPin className="w-3.5 h-3.5 text-[#58149C] dark:text-[#A380FE] shrink-0 mt-0.5" />
                  <span className="line-clamp-2">
                    {[ticket.streetName || ticket.address, ticket.clusterName, ticket.area]
                      .filter(Boolean)
                      .join(' · ') || 'Alamat tidak tersedia'}
                  </span>
                </div>

                {/* Quick Template Selector for Unconfirmed Tickets */}
                {!isConfirmed ? (
                  <div className="space-y-2">
                    <span className="text-[10.5px] font-bold uppercase tracking-wider text-[#58149C] dark:text-[#DAB9FF] block">
                      Pilih Pesan Cepat (Otomatisasi):
                    </span>
                    <div className="space-y-1.5">
                      {quickTemplateChoices.map(tpl => {
                        const isChecked = selectedQuickId === tpl.id;
                        const snippet = renderWhatsAppMessage(tpl.messageBody, ticket).renderedText;
                        return (
                          <label
                            key={tpl.id}
                            className={`flex items-start gap-2 p-2 rounded-xl border text-xs cursor-pointer transition-colors ${
                              isChecked
                                ? 'bg-[#f3eaff] dark:bg-[#2A194B] border-[#7135B5] dark:border-[#A380FE]'
                                : 'bg-[#f8f1ff] dark:bg-[#160D29] border-[#e8ddff] dark:border-[#35105E] hover:border-[#cec3d4]'
                            }`}
                          >
                            <input
                              type="radio"
                              name={`quick-tpl-${ticket.id}`}
                              checked={isChecked}
                              onChange={() =>
                                setSelectedQuickTplByTicket(prev => ({
                                  ...prev,
                                  [ticket.id]: tpl.id
                                }))
                              }
                              className="mt-0.5 accent-[#58149C]"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="font-bold text-[#1f1638] dark:text-[#f5eeff] truncate">
                                {tpl.shortLabel}
                              </div>
                              <div className="text-[11px] text-[#4b4452] dark:text-[#C4B5D6] line-clamp-1 mt-0.5">
                                &ldquo;{snippet}&rdquo;
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => sendRenderedWhatsApp(ticket, renderedQuickPreview)}
                      className="mj-btn-installer-success w-full px-4 py-2 text-xs sm:text-sm font-extrabold gap-1.5 cursor-pointer"
                    >
                      <Zap className="w-4 h-4 shrink-0" />
                      <span>Kirim Template Konfirmasi</span>
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl bg-[#ECFDF5] dark:bg-emerald-950/35 border border-[#86EFAC] dark:border-emerald-700/60 p-2.5 text-xs text-[#15803D] dark:text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span className="font-semibold">
                      Pelanggan sudah mengonfirmasi jadwal kedatangan teknisi.
                    </span>
                  </div>
                )}

                {/* Card Footer Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#e8ddff] dark:border-[#35105E]">
                  <button
                    type="button"
                    onClick={() => onSelectTicket(ticket)}
                    className="mj-btn-installer-neutral mj-btn-compact px-3 py-1.5 text-xs font-bold gap-1.5 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF]" />
                    <span>Detail WO</span>
                  </button>

                  <div className="flex items-center gap-1.5 ml-auto">
                    <button
                      type="button"
                      onClick={() => onOpenWhatsAppModal(ticket)}
                      className="mj-btn-installer-neutral mj-btn-compact px-3 py-1.5 text-xs font-bold cursor-pointer whitespace-nowrap"
                    >
                      Editor Pesan
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        sendRenderedWhatsApp(
                          ticket,
                          selectedQuickObj?.messageBody || FALLBACK_QUICK_TEMPLATES[0].messageBody
                        )
                      }
                      className="mj-btn-installer-success mj-btn-compact gap-1.5 px-3.5 py-1.5 text-xs font-bold cursor-pointer whitespace-nowrap"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Buka WA</span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* =============================================================== */}
      {/* 4. TEMPLATE PESAN RESMI SOP + DARK INSET LIVE PREVIEW           */}
      {/* =============================================================== */}
      <section className="card-3d-lavender rounded-2xl p-4 sm:p-5 space-y-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#f3eaff] dark:bg-[#2A194B] border border-[#e8ddff] dark:border-[#4B386B] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-extrabold text-sm sm:text-base text-[#1f1638] dark:text-[#f5eeff] truncate">
                Template Pesan Resmi SOP
              </h3>
              <p className="text-[11.5px] text-[#4b4452] dark:text-[#C4B5D6] truncate">
                Format baku komunikasi lapangan agar seragam &amp; profesional ke pelanggan.
              </p>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-[#f3eaff] dark:bg-[#2A194B] border border-[#e8ddff] dark:border-[#4B386B] font-mono text-[10px] font-bold text-[#58149C] dark:text-[#DAB9FF] shrink-0">
            Auto-Fill
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-[#1f1638] dark:text-[#f5eeff] mb-1">
              Pilih Template SOP
            </label>
            <select
              value={selectedSopTemplateId}
              onChange={e => setSelectedSopTemplateId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-[#f8f1ff] dark:bg-[#160D29] border border-[#e8ddff] dark:border-[#35105E] text-xs font-semibold text-[#1f1638] dark:text-[#f5eeff] focus:outline-none focus:ring-2 focus:ring-[#7135B5] cursor-pointer"
            >
              {sopTemplateOptions.map(tpl => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-[#1f1638] dark:text-[#f5eeff] mb-1">
              Target Pelanggan Aktif
            </label>
            <select
              value={selectedPreviewTicketId}
              disabled={myTickets.length === 0}
              onChange={e => setSelectedPreviewTicketId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-[#f8f1ff] dark:bg-[#160D29] border border-[#e8ddff] dark:border-[#35105E] text-xs font-semibold text-[#1f1638] dark:text-[#f5eeff] focus:outline-none focus:ring-2 focus:ring-[#7135B5] cursor-pointer disabled:opacity-50"
            >
              {myTickets.length === 0 ? (
                <option value="">Belum ada WO ditugaskan</option>
              ) : (
                myTickets.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.woNumber} · {t.customerName}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Dark Purple Inset Live Preview Box */}
        <div className="rounded-xl bg-[#160D29] border border-[#35105E] p-3.5 text-white space-y-2 shadow-inner">
          <div className="flex items-center justify-between gap-2 text-[10.5px] font-mono border-b border-white/10 pb-2">
            <span className="text-[#DAB9FF] font-bold truncate">
              Target:{' '}
              {activePreviewTicket
                ? `${activePreviewTicket.customerName} (${activePreviewTicket.customerPhone || '-'})`
                : 'Belum ada pelanggan aktif'}
            </span>
            <span className="text-emerald-300 font-bold shrink-0">PREVIEW LIVE</span>
          </div>
          <p className="text-xs font-mono text-[#EEDBFF] leading-relaxed whitespace-pre-wrap">
            {renderedSopPreview || 'Pilih template SOP dan target pelanggan untuk melihat pratinjau pesan.'}
          </p>
        </div>

        <button
          type="button"
          disabled={!activePreviewTicket}
          onClick={() => {
            if (activePreviewTicket && activeSopTemplate) {
              sendRenderedWhatsApp(activePreviewTicket, activeSopTemplate.messageBody);
            }
          }}
          className="mj-btn-installer-primary w-full px-4 py-2.5 text-xs sm:text-sm font-extrabold gap-2 cursor-pointer"
        >
          <Send className="w-4 h-4 shrink-0" />
          <span>Kirim via WhatsApp</span>
        </button>
      </section>
    </div>
  );
};
