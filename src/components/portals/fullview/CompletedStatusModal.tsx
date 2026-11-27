import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  X
} from 'lucide-react';
import type { HierarchicalStatus, Ticket } from '../../../types/index.ts';
import { ResponsiveModal } from '../../common/ResponsiveModal';
import {
  getActiveReasonsForStatus,
  resolveCompletedStatusHierarchy
} from '../../../utils/fullviewWorkflow';

export interface CompletedStatusModalProps {
  isOpen: boolean;
  ticket: Ticket;
  hierarchicalStatuses: HierarchicalStatus[];
  reportStatus: string;
  reportStatusId: string;
  reasonReport: string;
  reasonReportId: string;
  remarksReport: string;
  isMandatoryEvidenceReady: boolean;
  mandatoryPhotoCount: number;
  isAnySlotUploading: boolean;
  isSubmittingReport: boolean;
  onSelectStatusAndReason: (payload: {
    reportStatus: string;
    reportStatusId: string;
    reasonReport: string;
    reasonReportId: string;
  }) => void;
  onChangeRemarks: (value: string) => void;
  onGoToPhotos: () => void;
  onConfirmSave: () => void;
  onClose: () => void;
}

export const CompletedStatusModal: React.FC<CompletedStatusModalProps> = ({
  isOpen,
  ticket,
  hierarchicalStatuses,
  reportStatus,
  reportStatusId,
  reasonReport,
  reasonReportId,
  remarksReport,
  isMandatoryEvidenceReady,
  mandatoryPhotoCount,
  isAnySlotUploading,
  isSubmittingReport,
  onSelectStatusAndReason,
  onChangeRemarks,
  onGoToPhotos,
  onConfirmSave,
  onClose
}) => {
  const [formError, setFormError] = useState<string | null>(null);

  const hierarchy = useMemo(
    () => resolveCompletedStatusHierarchy(hierarchicalStatuses),
    [hierarchicalStatuses]
  );

  // Pick active Level-1 Completed status matching current selection or default
  const activeStatus = useMemo(() => {
    if (!hierarchy.availableStatuses.length) return null;
    const match = hierarchy.availableStatuses.find(
      s =>
        s.id === reportStatusId ||
        s.name.trim().toLowerCase() === reportStatus.trim().toLowerCase() ||
        (s.code && s.code.trim().toLowerCase() === reportStatus.trim().toLowerCase())
    );
    return match || hierarchy.defaultStatus;
  }, [hierarchy, reportStatus, reportStatusId]);

  const activeReasons = useMemo(
    () => getActiveReasonsForStatus(activeStatus),
    [activeStatus]
  );

  const selectedReasonObj = useMemo(() => {
    if (!activeReasons.length) return null;
    return (
      activeReasons.find(
        r =>
          r.id === reasonReportId ||
          r.name.trim().toLowerCase() === reasonReport.trim().toLowerCase()
      ) || null
    );
  }, [activeReasons, reasonReport, reasonReportId]);

  const remarksTemplates = useMemo(() => {
    if (!selectedReasonObj?.remarks) return [];
    return selectedReasonObj.remarks
      .filter(rm => rm.active !== false && (rm as { isActive?: boolean }).isActive !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(rm => rm.text || rm.name)
      .filter(Boolean);
  }, [selectedReasonObj]);

  // Synchronize Level-1 Completed status cleanly when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setFormError(null);
    if (!activeStatus) return;

    const currentMatchesStatus =
      reportStatusId === activeStatus.id ||
      reportStatus.trim().toLowerCase() === activeStatus.name.trim().toLowerCase();
    const validChildReason = activeReasons.find(
      r =>
        r.id === reasonReportId ||
        r.name.trim().toLowerCase() === reasonReport.trim().toLowerCase()
    );

    if (!currentMatchesStatus || (!validChildReason && activeReasons.length === 1)) {
      const nextReason = validChildReason || (activeReasons.length === 1 ? activeReasons[0] : null);
      onSelectStatusAndReason({
        reportStatus: activeStatus.name,
        reportStatusId: activeStatus.id,
        reasonReport: nextReason?.name || '',
        reasonReportId: nextReason?.id || ''
      });
    }
  }, [
    isOpen,
    activeStatus?.id,
    activeStatus?.name,
    activeReasons,
    reportStatus,
    reportStatusId,
    reasonReport,
    reasonReportId,
    onSelectStatusAndReason
  ]);

  const handleSaveClick = () => {
    if (isSubmittingReport || isAnySlotUploading) return;

    if (!activeStatus) {
      setFormError('Konfigurasi Status WO Completed tidak ditemukan di Setting Droplist.');
      return;
    }
    if (!selectedReasonObj) {
      setFormError('Pilih status penyelesaian / Reason WO (Level 2) terlebih dahulu.');
      return;
    }
    if (!remarksReport.trim()) {
      setFormError('Remarks wajib diisi sebelum menyimpan penyelesaian Work Order.');
      return;
    }
    if (!isMandatoryEvidenceReady) {
      setFormError(
        `Foto bukti wajib belum lengkap (${mandatoryPhotoCount}/3). Unggah 3 foto wajib (Rumah, Tiang FAT, Redaman FAT) terlebih dahulu.`
      );
      return;
    }

    setFormError(null);
    onConfirmSave();
  };

  return (
    <ResponsiveModal
      isOpen={isOpen}
      onClose={onClose}
      title="STATUS WO COMPLETED"
      subtitle={`WO ${ticket.woNumber} • ${ticket.customerName}`}
      icon={<CheckCircle2 className="w-4 h-4 text-[#218A63] dark:text-emerald-400" />}
      size="md"
      mobileVariant="sheet"
      variant="dark_purple"
      layerTier="nested"
      closeOnBackdropClick={!isSubmittingReport}
      footer={
        <div className="w-full flex items-center gap-2.5">
          <button
            type="button"
            disabled={isSubmittingReport}
            onClick={onClose}
            className="mj-btn-installer-neutral min-h-[48px] flex-1 py-2.5 px-4 text-xs font-bold cursor-pointer disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={isSubmittingReport || isAnySlotUploading || !hierarchy.isConfigured}
            onClick={handleSaveClick}
            data-testid="completed-modal-save-btn"
            className={`mj-btn-installer-success min-h-[48px] flex-[1.5] py-2.5 px-4 text-xs font-bold gap-1.5 cursor-pointer disabled:opacity-50 ${
              isSubmittingReport ? 'mj-btn-loading' : ''
            }`}
          >
            {isSubmittingReport ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ClipboardCheck className="w-4 h-4" />
            )}
            <span>{isSubmittingReport ? 'Memproses...' : 'Simpan'}</span>
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Level 1 Status Badge / Selector */}
        {hierarchy.availableStatuses.length > 1 ? (
          <div className="space-y-2">
            <label className="block text-[11px] font-mono uppercase tracking-wider font-bold text-[#52647A] dark:text-[#C4B5D6]">
              Level 1: Status WO *
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {hierarchy.availableStatuses.map(st => {
                const selected = activeStatus?.id === st.id;
                return (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => {
                      const nextReasons = getActiveReasonsForStatus(st);
                      onSelectStatusAndReason({
                        reportStatus: st.name,
                        reportStatusId: st.id,
                        reasonReport: nextReasons.length === 1 ? nextReasons[0].name : '',
                        reasonReportId: nextReasons.length === 1 ? nextReasons[0].id : ''
                      });
                      setFormError(null);
                    }}
                    className={`min-h-[44px] px-3 py-2.5 rounded-xl border text-left text-xs font-bold flex items-center justify-between gap-2 transition-all cursor-pointer ${
                      selected
                        ? 'bg-[#E4F5EC] dark:bg-emerald-950/50 border-[#27A074] dark:border-emerald-500 text-[#1B6B4D] dark:text-emerald-200'
                        : 'bg-[#F8FAFD] dark:bg-[#1E1238] border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-[#E8DDFF]'
                    }`}
                  >
                    <span>{st.name}</span>
                    {selected && <CheckCircle2 className="w-4 h-4 text-[#218A63] dark:text-emerald-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        ) : activeStatus ? (
          <div className="rounded-xl bg-[#E4F5EC] dark:bg-emerald-950/40 border border-[#B7E4CC] dark:border-emerald-800/60 px-3.5 py-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#218A63] dark:text-emerald-300 block">
                Level 1 · Status WO
              </span>
              <span className="font-display text-sm font-extrabold text-[#1B6B4D] dark:text-emerald-100">
                {activeStatus.name}
              </span>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-white/80 dark:bg-emerald-900/50 border border-[#B7E4CC] dark:border-emerald-700 font-mono text-[10px] font-bold text-[#218A63] dark:text-emerald-300 shrink-0">
              {activeReasons.length} Opsi
            </span>
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-[#FCE9EB] dark:bg-rose-950/50 border border-[#F3C5CA] dark:border-rose-800/60 text-xs text-[#9B2C37] dark:text-rose-200">
            Status WO Completed belum dikonfigurasi aktif pada Setting Droplist. Hubungi Superadmin.
          </div>
        )}

        {/* Level 2 Reason Cards */}
        {activeStatus && (
          <div className="space-y-2">
            <label className="block text-[11px] font-mono uppercase tracking-wider font-bold text-[#52647A] dark:text-[#C4B5D6]">
              Pilih Hasil Penyelesaian (Level 2) *
            </label>
            {activeReasons.length === 0 ? (
              <div className="p-3 rounded-xl bg-[#FFF2D9] dark:bg-amber-950/40 border border-[#F2CF95] dark:border-amber-800/60 text-xs text-[#9D661F] dark:text-amber-200">
                Belum ada opsi Level 2 Reason WO aktif di bawah status <strong>{activeStatus.name}</strong>.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 max-h-[240px] overflow-y-auto pr-0.5">
                {activeReasons.map(reason => {
                  const isSelected = selectedReasonObj?.id === reason.id;
                  const subNote =
                    (reason as { description?: string }).description ||
                    (reason.remarks && reason.remarks.length > 0
                      ? `${reason.remarks.length} template catatan tersedia`
                      : reason.code
                      ? `Kode: ${reason.code}`
                      : undefined);
                  return (
                    <button
                      key={reason.id}
                      type="button"
                      onClick={() => {
                        onSelectStatusAndReason({
                          reportStatus: activeStatus.name,
                          reportStatusId: activeStatus.id,
                          reasonReport: reason.name,
                          reasonReportId: reason.id
                        });
                        setFormError(null);
                      }}
                      className={`w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border text-left flex items-center justify-between gap-2.5 transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[#E4F5EC] dark:bg-emerald-950/55 border-[#27A074] dark:border-emerald-500 text-[#1B6B4D] dark:text-emerald-100 shadow-xs'
                          : 'bg-[#F8FAFD] dark:bg-[#1E1238] border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-[#E8DDFF] hover:border-[#27A074]/60'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold leading-snug">{reason.name}</div>
                        {subNote && (
                          <div className="text-[10.5px] opacity-80 mt-0.5 truncate">{subNote}</div>
                        )}
                      </div>
                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border ${
                          isSelected
                            ? 'bg-[#218A63] dark:bg-emerald-500 border-[#218A63] dark:border-emerald-500 text-white'
                            : 'border-[#CBD5E1] dark:border-[#4B386B]'
                        }`}
                      >
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Quick Remarks Templates (when configured on selected Reason) */}
        {remarksTemplates.length > 0 && (
          <div className="space-y-1.5">
            <span className="block text-[10px] font-mono uppercase tracking-wider font-bold text-[#8492A5] dark:text-[#A79BC0]">
              Template Catatan Cepat
            </span>
            <div className="flex flex-wrap gap-1.5">
              {remarksTemplates.map((tpl, idx) => (
                <button
                  key={`${tpl}-${idx}`}
                  type="button"
                  onClick={() => {
                    onChangeRemarks(tpl);
                    setFormError(null);
                  }}
                  className="mj-btn-installer-neutral mj-btn-xs px-2.5 py-1 text-[11px] font-semibold cursor-pointer"
                >
                  {tpl}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Mandatory Remarks Field */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="completed-remarks-input"
              className="block text-[11px] font-mono uppercase tracking-wider font-bold text-[#52647A] dark:text-[#C4B5D6]"
            >
              Remarks *
            </label>
            <span className="font-mono text-[10px] text-[#8492A5] dark:text-[#A79BC0]">
              {remarksReport.trim().length} karakter
            </span>
          </div>
          <textarea
            id="completed-remarks-input"
            rows={3}
            value={remarksReport}
            disabled={isSubmittingReport}
            onChange={e => {
              onChangeRemarks(e.target.value);
              if (formError) setFormError(null);
            }}
            placeholder="Masukkan keterangan tambahan hasil pekerjaan..."
            className="w-full px-3 py-2.5 rounded-xl bg-[#F8FAFD] dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] text-xs text-[#26364A] dark:text-[#f5eeff] placeholder:text-[#8492A5] dark:placeholder:text-[#A79BC0] focus:outline-none focus:ring-2 focus:ring-[#27A074] dark:focus:ring-emerald-500 resize-none"
          />
        </div>

        {/* Evidence Readiness Notice */}
        {!isMandatoryEvidenceReady && (
          <div className="p-3 rounded-xl bg-[#FFF2D9] dark:bg-amber-950/40 border border-[#F2CF95] dark:border-amber-800/60 flex items-center justify-between gap-2.5 text-xs">
            <div className="flex items-start gap-2 min-w-0 text-[#9D661F] dark:text-amber-200">
              <Camera className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Foto bukti wajib masih <strong>{mandatoryPhotoCount}/3</strong>. Lengkapi Foto Rumah, Tiang FAT &amp; Redaman FAT sebelum Check-Out.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onGoToPhotos();
              }}
              className="mj-btn-installer-warning mj-btn-xs px-2.5 py-1.5 text-[11px] font-bold shrink-0 cursor-pointer"
            >
              Upload Foto
            </button>
          </div>
        )}

        {formError && (
          <div className="p-2.5 rounded-xl bg-[#FCE9EB] dark:bg-rose-950/60 border border-[#F3C5CA] dark:border-rose-700 text-[#9B2C37] dark:text-rose-200 text-xs font-medium flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">{formError}</span>
            <button
              type="button"
              onClick={() => setFormError(null)}
              aria-label="Tutup pesan error"
              className="shrink-0 opacity-75 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </ResponsiveModal>
  );
};
