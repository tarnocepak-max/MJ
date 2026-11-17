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
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-3 sm:p-4">
      <div className="bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E] rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#160D29] flex items-center justify-between gap-4">
          <div>
            <h3 className="font-display font-bold text-base text-[#211A2E] dark:text-white">
              Detail Work Order — {vendor.contractorName}
            </h3>
            <p className="text-xs text-[#766B83] dark:text-[#A78BFA]">
              Area: {vendor.primaryArea} • Korlap: {vendor.leaderName} • {filteredTickets.length} Work Order ditemukan
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-[#766B83] hover:bg-white dark:hover:bg-[#35105E]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-[#E9E5F0] dark:border-[#35105E] bg-white dark:bg-[#1E1238]">
          <div className="relative">
            <Search className="w-4 h-4 text-[#8B8495] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cari No. WO, nama pelanggan, area, atau teknisi..."
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#140827] text-[#211A2E] dark:text-white"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[#E9E5F0] dark:divide-[#35105E]">
          {filteredTickets.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#766B83]">
              Tidak ada Work Order yang cocok untuk filter saat ini.
            </div>
          ) : (
            filteredTickets.map(ticket => (
              <div
                key={ticket.id}
                className="px-6 py-3.5 hover:bg-[#F7F6FA] dark:hover:bg-[#160D29]/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-[#431599] dark:text-[#D8B4FE]">
                      {ticket.woNumber}
                    </span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-[#35105E] text-[#211A2E] dark:text-white">
                      {ticket.statusWOInstaller || 'Unassigned'}
                    </span>
                    {ticket.approvalStatus && ticket.approvalStatus !== 'NONE' && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200">
                        {ticket.approvalStatus}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-[#211A2E] dark:text-white mt-0.5 truncate">
                    {ticket.customerName} • <span className="font-normal text-[#766B83]">{ticket.area}</span>
                  </p>
                  <p className="text-[11px] text-[#766B83] mt-0.5">
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
                    className="px-2.5 py-1.5 rounded-lg border border-[#E9E5F0] dark:border-[#35105E] text-[11px] font-semibold text-[#211A2E] dark:text-white hover:bg-slate-50 dark:hover:bg-[#35105E] flex items-center gap-1"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-[#7135B5]" />
                    LiveChat
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSelectTicket(ticket, 'overview');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#431599] hover:bg-[#35105E] text-white text-[11px] font-bold flex items-center gap-1"
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
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-3 sm:p-4">
      <div className="bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E] rounded-2xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col overflow-hidden">
        <div className={`px-4 sm:px-6 py-4 border-b border-[#E9E5F0] dark:border-[#35105E] flex items-center justify-between gap-2 shrink-0 ${isCriticalStyle ? 'bg-rose-50 dark:bg-rose-950/30' : 'bg-[#F7F6FA] dark:bg-[#160D29]'}`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isCriticalStyle ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-300' : 'bg-[#431599]/10 text-[#431599] dark:text-[#D8B4FE]'}`}>
              {context.actionType === 'ISSUE_SP1' ? <FileWarning className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-sm text-[#211A2E] dark:text-white truncate">{context.title}</h3>
              <p className="text-[11px] text-[#766B83] dark:text-[#A78BFA] truncate">{context.subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-[#766B83] hover:bg-white/70 shrink-0 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleConfirm} className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-[#F7F6FA] dark:bg-[#140827] p-3 rounded-xl border border-[#E9E5F0] dark:border-[#35105E]">
            <div>
              <span className="text-[10px] uppercase font-bold text-[#8B8495] block">Vendor / Mitra</span>
              <span className="font-semibold text-[#211A2E] dark:text-white">{context.contractorName || 'Semua Vendor Aktif'}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-[#8B8495] block">
                {context.woNumber ? 'No. Work Order' : 'Target Korlap'}
              </span>
              <span className="font-semibold font-mono text-[#211A2E] dark:text-white">
                {context.woNumber || context.leaderName || 'Semua Korlap'}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#766B83] mb-1">
              Instruksi / Pesan Resmi
            </label>
            <textarea
              rows={4}
              value={message}
              onChange={e => setMessage(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-white dark:bg-[#140827] text-[#211A2E] dark:text-white"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#766B83] mb-1">
              Alasan / Referensi Audit (Opsional)
            </label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Contoh: Breach SLA > 15 menit pada Slot 3"
              className="w-full px-3 py-2 text-xs rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-white dark:bg-[#140827] text-[#211A2E] dark:text-white"
            />
          </div>

          {context.ticketId && (
            <label className="flex items-center gap-2 text-xs text-[#211A2E] dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={postToLiveChat}
                onChange={e => setPostToLiveChat(e.target.checked)}
                className="w-4 h-4 accent-[#431599]"
              />
              <span>Lampirkan catatan koordinasi ke LiveChat WO (Kategori ISSUE/GENERAL, tidak memicu Check-in)</span>
            </label>
          )}

          <div className="pt-2 flex items-center justify-between gap-2">
            {waHref ? (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 flex items-center gap-1.5"
              >
                <PhoneCall className="w-3.5 h-3.5" />
                Buka WhatsApp Korlap
              </a>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-[#E9E5F0] dark:border-[#35105E] text-xs font-semibold text-[#766B83] hover:text-[#211A2E]"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className={`px-4 py-2 rounded-xl text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 ${
                  isCriticalStyle ? 'bg-[#DC4C5A] hover:bg-rose-700' : 'bg-[#431599] hover:bg-[#35105E]'
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
