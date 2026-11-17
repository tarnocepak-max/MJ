import React, { useState, useEffect } from 'react';
import { AlertTriangle, ShieldAlert, X, CheckCircle2, Info } from 'lucide-react';

export interface EscalationReasonOption {
  id: string;
  label: string;
  description?: string;
  targetInstallerStatus?: 'Pending Technical' | 'Failed / Cancelled';
  isReschedule?: boolean;
}

interface TactileConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: string;
  variant?: 'danger' | 'warning' | 'primary';
  confirmLabel?: string;
  cancelLabel?: string;
  reasonOptions?: EscalationReasonOption[];
  requireNotes?: boolean;
  notesLabel?: string;
  notesPlaceholder?: string;
  isSubmitting?: boolean;
  onConfirm: (payload: { selectedReason?: EscalationReasonOption; notes: string }) => void | Promise<void>;
}

export const TactileConfirmModal: React.FC<TactileConfirmModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  badge = 'KONFIRMASI OPERASIONAL',
  variant = 'danger',
  confirmLabel = 'Konfirmasi',
  cancelLabel = 'Kembali',
  reasonOptions,
  requireNotes = false,
  notesLabel = 'Catatan Lapangan / Penjelasan',
  notesPlaceholder = 'Tuliskan detail kendala, patokan lokasi, atau permintaan reschedule...',
  isSubmitting = false,
  onConfirm
}) => {
  const [selectedId, setSelectedId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedId(reasonOptions?.[0]?.id || '');
      setNotes('');
      setLocalError(null);
    }
  }, [isOpen, reasonOptions]);

  if (!isOpen) return null;

  const selectedReason = reasonOptions?.find(r => r.id === selectedId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reasonOptions && reasonOptions.length > 0 && !selectedReason) {
      setLocalError('Pilih salah satu alasan terlebih dahulu.');
      return;
    }
    if (requireNotes && !notes.trim()) {
      setLocalError('Catatan lapangan wajib diisi agar Dispatch dapat menindaklanjuti.');
      return;
    }
    setLocalError(null);
    await onConfirm({ selectedReason, notes: notes.trim() });
  };

  const isDanger = variant === 'danger';
  const isWarning = variant === 'warning';

  const IconComp = isDanger ? ShieldAlert : isWarning ? AlertTriangle : Info;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[10001] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#160D29]/70 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="absolute inset-0" onClick={onClose} />

      <form
        onSubmit={handleSubmit}
        className="mj-sheet-enter relative z-10 w-full sm:max-w-lg bg-[#FDF7FF] dark:bg-[#1E1238] rounded-t-[1.5rem] sm:rounded-3xl border border-[#E8DDFF] dark:border-[#5B35B1]/50 shadow-[0_-12px_40px_rgba(22,13,41,0.35),0_20px_50px_rgba(22,13,41,0.45)] overflow-hidden"
      >
        {/* Pull handle on mobile */}
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden">
          <div className="w-10 h-1.5 rounded-full bg-[#CEC3D4] dark:bg-[#4B386B]" />
        </div>

        {/* Header */}
        <div className="px-5 pt-3 pb-3.5 border-b border-[#E8DDFF] dark:border-[#35105E] flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
                isDanger
                  ? 'bg-rose-50 dark:bg-rose-950/70 border-rose-200 dark:border-rose-500/40 text-[#BA1A1A] dark:text-rose-300 shadow-[0_2px_0_rgba(186,26,26,0.2)]'
                  : isWarning
                  ? 'bg-amber-50 dark:bg-amber-950/70 border-amber-200 dark:border-amber-500/40 text-amber-600 dark:text-amber-300 shadow-[0_2px_0_rgba(217,119,6,0.2)]'
                  : 'bg-[#F3EAFF] dark:bg-[#35105E] border-[#E8DDFF] dark:border-[#7135B5] text-[#58149C] dark:text-[#DAB9FF]'
              }`}
            >
              <IconComp className="w-5 h-5" />
            </div>
            <div>
              <span
                className={`text-[10px] font-extrabold uppercase tracking-wider block ${
                  isDanger
                    ? 'text-[#BA1A1A] dark:text-rose-300'
                    : isWarning
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-[#58149C] dark:text-[#DAB9FF]'
                }`}
              >
                {badge}
              </span>
              <h3 className="font-display font-bold text-[17px] text-[#1F1638] dark:text-white leading-snug mt-0.5">
                {title}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="tactile-pill-btn p-2 rounded-full bg-white dark:bg-[#2A1647] text-[#4B4452] dark:text-[#E9D5FF] border border-[#E8DDFF] dark:border-[#4B386B] cursor-pointer"
            aria-label="Tutup dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {subtitle && (
            <p className="text-[12.5px] text-[#4B4452] dark:text-[#E9D5FF]/90 leading-relaxed">
              {subtitle}
            </p>
          )}

          {reasonOptions && reasonOptions.length > 0 && (
            <div className="space-y-2">
              <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[#7D7484] dark:text-[#CEC0E8]">
                Pilih Alasan Operasional
              </label>
              <div className="space-y-2">
                {reasonOptions.map(opt => {
                  const active = selectedId === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(opt.id);
                        setLocalError(null);
                      }}
                      className={`w-full text-left p-3 rounded-xl border transition-all flex items-start gap-3 cursor-pointer ${
                        active
                          ? 'bg-[#F3EAFF] dark:bg-[#35105E] border-[#58149C] dark:border-[#A380FE] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_2px_0_#D8CCF3] dark:shadow-none'
                          : 'bg-white dark:bg-[#160D29] border-[#E8DDFF] dark:border-[#35105E] hover:border-[#CEC3D4]'
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          active
                            ? 'border-[#58149C] bg-[#58149C] dark:border-[#DAB9FF] dark:bg-[#DAB9FF]'
                            : 'border-[#CEC3D4] dark:border-[#4B386B]'
                        }`}
                      >
                        {active && <span className="w-1.5 h-1.5 rounded-full bg-white dark:bg-[#160D29]" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-[12.5px] text-[#1F1638] dark:text-white">
                          {opt.label}
                        </div>
                        {opt.description && (
                          <div className="text-[11px] text-[#7D7484] dark:text-[#CEC0E8]/80 mt-0.5">
                            {opt.description}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[#7D7484] dark:text-[#CEC0E8] mb-1.5">
              {notesLabel} {requireNotes && <span className="text-[#BA1A1A]">*</span>}
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={e => {
                setNotes(e.target.value);
                if (localError) setLocalError(null);
              }}
              placeholder={notesPlaceholder}
              className="tactile-debossed-input w-full rounded-xl bg-white dark:bg-[#160D29] p-3 text-[12.5px] text-[#1F1638] dark:text-white placeholder:text-[#7D7484] focus:outline-none focus:ring-2 focus:ring-[#58149C]"
            />
          </div>

          {localError && (
            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-500/40 text-[#BA1A1A] dark:text-rose-200 text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{localError}</span>
            </div>
          )}
        </div>

        {/* Footer 3D Tactile Buttons */}
        <div className="px-5 py-4 bg-white dark:bg-[#160D29] border-t border-[#E8DDFF] dark:border-[#35105E] flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="tactile-btn-secondary px-4 py-2.5 min-h-[44px] rounded-xl bg-white dark:bg-[#22123F] text-[#4B4452] dark:text-[#E9D5FF] border border-[#CEC3D4] dark:border-[#4B386B] font-bold text-[13px] cursor-pointer"
          >
            {cancelLabel}
          </button>

          <button
            type="submit"
            disabled={isSubmitting}
            className={`px-5 py-2.5 min-h-[44px] rounded-xl font-bold text-[13px] text-white flex items-center justify-center gap-2 cursor-pointer transition-all active:translate-y-0.5 disabled:opacity-60 ${
              isDanger
                ? 'bg-[#BA1A1A] hover:bg-[#93000A] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_4px_0_#7F1D1D]'
                : isWarning
                ? 'bg-amber-600 hover:bg-amber-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_4px_0_#92400E]'
                : 'tactile-btn-primary bg-gradient-to-r from-[#58149C] to-[#7135B5]'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{isSubmitting ? 'Memproses...' : confirmLabel}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
