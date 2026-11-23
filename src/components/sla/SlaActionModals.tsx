import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Search,
  ExternalLink,
  AlertTriangle,
  Send,
  Loader2,
  PhoneCall,
  MessageSquare,
  FileWarning,
  ShieldAlert
} from 'lucide-react';
import type { Ticket } from '../../types/index';
import type { SlaActionType, SlaVendorRow } from '../../types/sla';

interface VendorWoDrilldownModalProps {
  isOpen: boolean;
  onClose: () => void;
  vendor: SlaVendorRow | null;
  tickets: Ticket[];
  onSelectTicket: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
}

export const VendorWoDrilldownModal: React.FC<VendorWoDrilldownModalProps> = ({
  isOpen,
  onClose,
  vendor,
  tickets,
  onSelectTicket
}) => {
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (isOpen) setSearch('');
  }, [isOpen, vendor?.contractorId]);

  const filteredTickets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter(t => {
      if (!q) return true;
      return (
        String(t.woNumber || '').toLowerCase().includes(q)
        || String(t.customerName || '').toLowerCase().includes(q)
        || String(t.area || '').toLowerCase().includes(q)
        || String(t.installerName || '').toLowerCase().includes(q)
      );
    });
  }, [tickets, search]);

  if (!isOpen || !vendor) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center bg-[#26364A]/45 dark:bg-[#160D29]/75 backdrop-blur-sm sm:p-4">
      <div className="bg-white/95 dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-[#DDE6F0] dark:border-[#35105E] bg-[#EDF3F8] dark:bg-[#160D29] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-display font-bold text-base text-[#26364A] dark:text-white truncate">
              Detail Work Order — {vendor.contractorName}
            </h3>
            <p className="text-xs text-[#52647A] dark:text-[#DAB9FF] truncate">
              Area: {vendor.primaryArea} • Korlap: {vendor.leaderName} • {filteredTickets.length} Work Order ditemukan
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="btn-3d-icon w-10 h-10 sm:w-9 sm:h-9 shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 sm:px-6 py-3 border-b border-[#DDE6F0] dark:border-[#35105E] bg-white dark:bg-[#1E1238]">
          <div className="relative">
            <Search className="w-4 h-4 text-[#8492A5] dark:text-[#C5B3DF] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cari No. WO, nama pelanggan, area, atau teknisi..."
              className="tactile-debossed-input w-full pl-9 pr-4 py-2 min-h-[44px] sm:min-h-[38px] text-xs rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white placeholder:text-[#8492A5] focus:outline-none focus:ring-2 focus:ring-[#6657C8]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[#DDE6F0] dark:divide-[#35105E]">
          {filteredTickets.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#8492A5] dark:text-[#C5B3DF]">
              Tidak ada Work Order yang cocok untuk filter saat ini.
            </div>
          ) : (
            filteredTickets.map(ticket => (
              <div
                key={ticket.id}
                className="px-4 sm:px-6 py-3.5 hover:bg-[#F8FAFD] dark:hover:bg-[#251545]/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
                      {ticket.woNumber}
                    </span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#2E1459] text-[#26364A] dark:text-[#E8DDFF] border border-[#DCE3F2] dark:border-[#4B386B]">
                      {ticket.statusWOInstaller || 'Unassigned'}
                    </span>
                    {ticket.approvalStatus && ticket.approvalStatus !== 'NONE' && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[#DDF4F4] dark:bg-[#35105E] text-[#2E7D8B] dark:text-[#DAB9FF]">
                        {ticket.approvalStatus}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-[#26364A] dark:text-white mt-0.5 truncate">
                    {ticket.customerName} • <span className="font-normal text-[#52647A] dark:text-[#CEC0E8]">{ticket.area}</span>
                  </p>
                  <p className="text-[11px] text-[#8492A5] dark:text-[#C5B3DF] mt-0.5">
                    Slot: {ticket.slotTime || '-'} • Teknisi: {ticket.installerName || ticket.assignedTo || 'Belum Ditugaskan'}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSelectTicket(ticket, 'chat');
                    }}
                    className="btn-3d-ceramic px-3 py-1.5 min-h-[40px] sm:min-h-0 rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
                    LiveChat
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSelectTicket(ticket, 'overview');
                    }}
                    className="btn-3d-primary px-3 py-1.5 min-h-[40px] sm:min-h-0 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Buka Fullview
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export interface SlaActionModalContext {
  actionType: SlaActionType;
  title: string;
  subtitle: string;
  ticketId?: string;
  woNumber?: string;
  contractorId?: string;
  contractorName?: string;
  leaderName?: string;
  leaderPhone?: string;
  targetInstallerName?: string;
  defaultMessage: string;
}

interface SlaGovernanceActionModalProps {
  context: SlaActionModalContext | null;
  onClose: () => void;
  onSubmit: (payload: {
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
  }) => Promise<void>;
}

function toWaHref(phone?: string, message?: string): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (!digits || digits.length < 8) return null;
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) digits = `62${digits}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message || '')}`;
}

export const SlaGovernanceActionModal: React.FC<SlaGovernanceActionModalProps> = ({
  context,
  onClose,
  onSubmit
}) => {
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [postToLiveChat, setPostToLiveChat] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (context) {
      setMessage(context.defaultMessage);
      setReason('');
      setPostToLiveChat(Boolean(context.ticketId));
      setError(null);
    }
  }, [context]);

  if (!context) return null;

  const isCriticalStyle = context.actionType === 'ISSUE_SP1' || context.actionType === 'ESCALATE_DISPATCH';
  const waHref = toWaHref(context.leaderPhone, message);

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) {
      setError('Pesan tindakan wajib diisi.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit({
        actionType: context.actionType,
        ticketId: context.ticketId,
        woNumber: context.woNumber,
        contractorId: context.contractorId,
        contractorName: context.contractorName,
        leaderName: context.leaderName,
        leaderPhone: context.leaderPhone,
        targetInstallerName: context.targetInstallerName,
        message: message.trim(),
        reason: reason.trim() || undefined,
        postToLiveChat: Boolean(context.ticketId && postToLiveChat)
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Gagal mengeksekusi tindakan SLA.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center bg-[#26364A]/45 dark:bg-[#160D29]/75 backdrop-blur-sm sm:p-4">
      <div className="bg-white/95 dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col overflow-hidden">
        <div className={`px-4 sm:px-6 py-4 border-b border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-between gap-2 shrink-0 ${isCriticalStyle ? 'bg-[#FCE9EB] dark:bg-rose-950/35' : 'bg-[#EDF3F8] dark:bg-[#160D29]'}`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isCriticalStyle ? 'bg-[#FCE9EB] border border-[#F3C5CA] dark:border-transparent dark:bg-rose-900/50 text-[#9B2C37] dark:text-rose-300' : 'bg-[#EAE8FF] border border-[#DCE3F2] dark:border-transparent dark:bg-[#2E1459] text-[#5145A6] dark:text-[#DAB9FF]'}`}>
              {context.actionType === 'ISSUE_SP1' ? <FileWarning className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-sm text-[#26364A] dark:text-white truncate">{context.title}</h3>
              <p className="text-[11px] text-[#52647A] dark:text-[#DAB9FF] truncate">{context.subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup" className="btn-3d-icon w-10 h-10 sm:w-8 sm:h-8 shrink-0 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleConfirm} className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="p-3 rounded-xl bg-[#FCE9EB] dark:bg-rose-950/30 border border-[#F3C5CA] dark:border-rose-800 text-xs text-[#9B2C37] dark:text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="mj-tactile-well grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs p-3 border border-[#DDE6F0] dark:border-[#35105E]">
            <div>
              <span className="text-[10px] uppercase font-bold text-[#8492A5] dark:text-[#C5B3DF] block">Vendor / Mitra</span>
              <span className="font-semibold text-[#26364A] dark:text-white">{context.contractorName || 'Semua Vendor Aktif'}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-[#8492A5] dark:text-[#C5B3DF] block">
                {context.woNumber ? 'No. Work Order' : 'Target Korlap'}
              </span>
              <span className="font-semibold font-mono text-[#5145A6] dark:text-[#DAB9FF]">
                {context.woNumber || context.leaderName || 'Semua Korlap'}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF] mb-1">
              Instruksi / Pesan Resmi
            </label>
            <textarea
              rows={4}
              value={message}
              onChange={e => setMessage(e.target.value)}
              className="tactile-debossed-input w-full px-3 py-2 text-xs rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF] mb-1">
              Alasan / Referensi Audit (Opsional)
            </label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Contoh: Breach SLA > 15 menit pada Slot 3"
              className="tactile-debossed-input w-full px-3 py-2 min-h-[44px] sm:min-h-[38px] text-xs rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white placeholder:text-[#8492A5] focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
            />
          </div>

          {context.ticketId && (
            <label className="flex items-center gap-2 text-xs text-[#26364A] dark:text-[#E8DDFF] cursor-pointer">
              <input
                type="checkbox"
                checked={postToLiveChat}
                onChange={e => setPostToLiveChat(e.target.checked)}
                className="w-4 h-4 accent-[#6657C8] dark:accent-[#58149C]"
              />
              <span>Lampirkan catatan koordinasi ke LiveChat WO (Kategori ISSUE/GENERAL, tidak memicu Check-in)</span>
            </label>
          )}

          <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
            {waHref ? (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-3d-icon-wa px-3 py-2 min-h-[44px] sm:min-h-[38px] text-xs font-semibold flex items-center gap-1.5"
              >
                <PhoneCall className="w-3.5 h-3.5" />
                Buka WhatsApp Korlap
              </a>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="btn-3d-ceramic px-4 py-2 min-h-[44px] sm:min-h-[38px] rounded-xl text-xs font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className={`px-4 py-2 min-h-[44px] sm:min-h-[38px] rounded-xl text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer ${
                  isCriticalStyle ? 'btn-3d-danger' : 'btn-3d-primary'
                }`}
              >
                {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Kirim &amp; Catat Audit
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
