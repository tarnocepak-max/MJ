import React, { useState, useEffect } from 'react';
import { AlertTriangle, ShieldAlert, X, CheckCircle2, Info } from 'lucide-react';
import { NotificationInline } from '../notification/NotificationInline';
import { useVisualViewportModal } from '../../hooks/useVisualViewportModal';

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
  const vvMetrics = useVisualViewportModal(isOpen);

  useEffect(() => {
    if (isOpen) {
      setSelectedId(reasonOptions?.[0]?.id || '');
      setNotes('');
      setLocalError(null);
    }
  }, [isOpen, reasonOptions]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isSubmitting, onClose]);

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
      style={vvMetrics.keyboardInset > 0 ? { paddingBottom: `${vvMetrics.keyboardInset}px` } : undefined}
      className="fixed inset-0 z-[10001] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#26364A]/35 dark:bg-black/70 backdrop-blur-[4px] animate-in fade-in duration-150"
    >
      <div className="absolute inset-0" onClick={() => !isSubmitting && onClose()} />

      <form
        onSubmit={handleSubmit}
        style={vvMetrics.isKeyboardOpen ? { maxHeight: `${Math.max(260, vvMetrics.viewportHeight - 12)}px` } : undefined}
        className="mj-sheet-enter mj-notif-glass-panel relative z-10 w-full sm:max-w-lg max-h-[92dvh] rounded-t-[22px] sm:rounded-[22px] flex flex-col overflow-hidden"
      >
        {/* Pull handle on mobile */}
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden shrink-0">
          <div className="w-10 h-1.5 rounded-full bg-[#CFDCE8] dark:bg-[#5424A8]" />
        </div>

        {/* Header */}
        <div className="px-4 sm:px-5 pt-3.5 pb-3.5 bg-white/80 dark:bg-[#190C30]/80 border-b border-[#DDE6F0] dark:border-[#3D1D72] flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0 border ${
                isDanger
                  ? 'bg-[#FCE9EB] dark:bg-rose-950/75 border-[#F2BCC2] dark:border-rose-500/40 text-[#D45B66] dark:text-rose-300'
                  : isWarning
                  ? 'bg-[#FFF2D9] dark:bg-amber-950/75 border-[#F4D392] dark:border-amber-500/40 text-[#C88735] dark:text-amber-300'
                  : 'bg-[#DDF4F4] dark:bg-[#341668] border-[#DDE6F0] dark:border-[#8648F5]/55 text-[#5145A6] dark:text-[#DEC8FF]'
              }`}
            >
              <IconComp className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span
                className={`text-[10px] font-extrabold uppercase tracking-wider block ${
                  isDanger
                    ? 'text-[#D45B66] dark:text-rose-300'
                    : isWarning
                    ? 'text-[#C88735] dark:text-amber-300'
                    : 'text-[#6657C8] dark:text-[#C9A8FF]'
                }`}
              >
                {badge}
              </span>
              <h3 className="font-display font-extrabold text-[17px] text-[#26364A] dark:text-white leading-snug mt-0.5">
                {title}
              </h3>
            </div>
          </div>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="mj-notif-btn-3d-soft min-w-[44px] min-h-[44px] sm:w-9 sm:h-9 sm:min-w-[36px] sm:min-h-[36px] rounded-[11px] flex items-center justify-center cursor-pointer shrink-0"
            aria-label="Tutup dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 space-y-4 flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {subtitle && (
            <p className="text-[12.5px] text-[#52647A] dark:text-[#E9D5FF]/90 leading-relaxed">
              {subtitle}
            </p>
          )}

          {reasonOptions && reasonOptions.length > 0 && (
            <div className="space-y-2">
              <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[#52647A] dark:text-[#CEC0E8]">
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
                          ? 'bg-[#F0EDFF] dark:bg-[#35105E] border-[#6657C8] dark:border-[#A380FE] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_2px_0_#D2CEF2] dark:shadow-none'
                          : 'bg-white dark:bg-[#160D29] border-[#DDE6F0] dark:border-[#35105E] hover:border-[#65B8C4]'
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          active
                            ? 'border-[#6657C8] bg-[#6657C8] dark:border-[#DAB9FF] dark:bg-[#DAB9FF]'
                            : 'border-[#CFDCE8] dark:border-[#4B386B]'
                        }`}
                      >
                        {active && <span className="w-1.5 h-1.5 rounded-full bg-white dark:bg-[#160D29]" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-[12.5px] text-[#26364A] dark:text-white">
                          {opt.label}
                        </div>
                        {opt.description && (
                          <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]/80 mt-0.5">
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
            <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[#52647A] dark:text-[#CEC0E8] mb-1.5">
              {notesLabel} {requireNotes && <span className="text-[#D45B66] dark:text-[#BA1A1A]">*</span>}
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={e => {
                setNotes(e.target.value);
                if (localError) setLocalError(null);
              }}
              placeholder={notesPlaceholder}
              className="tactile-debossed-input w-full rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] p-3 text-[12.5px] text-[#26364A] dark:text-white placeholder:text-[#8492A5] focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#58149C]"
            />
          </div>

          {localError && (
            <NotificationInline variant="error" message={localError} />
          )}
        </div>

        {/* Footer 3D Tactile Buttons */}
        <div className="px-4 sm:px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] bg-[#F8FAFD] dark:bg-[#140929] border-t border-[#DDE6F0] dark:border-[#3D1D72] flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="mj-notif-btn-3d-soft px-4 py-2.5 min-h-[44px] rounded-[14px] font-bold text-[13px] cursor-pointer"
          >
            {cancelLabel}
          </button>

          <button
            type="submit"
            disabled={isSubmitting}
            className={`px-5 py-2.5 min-h-[44px] rounded-[14px] font-extrabold text-[13px] text-white flex items-center justify-center gap-2 cursor-pointer transition-all active:translate-y-0.5 disabled:opacity-60 ${
              isDanger
                ? 'bg-gradient-to-b from-[#E06D77] to-[#D45B66] dark:from-rose-500 dark:to-rose-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_3px_0_#AC3C47] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_4px_0_#7F1D1D]'
                : isWarning
                ? 'bg-gradient-to-b from-[#DA9A46] to-[#C88735] dark:from-amber-500 dark:to-amber-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_3px_0_#9D661F] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_4px_0_#92400E]'
                : 'mj-notif-btn-3d'
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
