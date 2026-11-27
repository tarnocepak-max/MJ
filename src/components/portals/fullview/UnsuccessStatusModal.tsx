import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CalendarClock,
  Camera,
  CheckCircle2,
  Clock,
  Loader2,
  ShieldAlert,
  X,
  XCircle
} from 'lucide-react';
import type { HierarchicalStatus, Ticket } from '../../../types/index.ts';
import { ResponsiveModal } from '../../common/ResponsiveModal';
import {
  resolveUnsuccessCategories,
  UnsuccessOptionKey
} from '../../../utils/fullviewWorkflow';

export interface UnsuccessStatusModalProps {
  isOpen: boolean;
  ticket: Ticket;
  hierarchicalStatuses: HierarchicalStatus[];
  remarksReport: string;
  isMandatoryEvidenceReady: boolean;
  mandatoryPhotoCount: number;
  isAnySlotUploading: boolean;
  isSubmittingReport: boolean;
  onChangeRemarks: (value: string) => void;
  onGoToPhotos: () => void;
  onSelectKendalaLapangan: () => void;
  onSubmitUnsuccessReport: (payload: {
    reportStatus: string;
    reportStatusId: string;
    reasonReport: string;
    reasonReportId: string;
    remarksReport: string;
  }) => Promise<void> | void;
  onClose: () => void;
}

const OPTION_ICONS: Record<UnsuccessOptionKey, React.ReactNode> = {
  pending: <Clock className="w-4 h-4" />,
  reschedule: <CalendarClock className="w-4 h-4" />,
  cancel: <XCircle className="w-4 h-4" />,
  kendala: <ShieldAlert className="w-4 h-4" />
};

export const UnsuccessStatusModal: React.FC<UnsuccessStatusModalProps> = ({
  isOpen,
  ticket,
  hierarchicalStatuses,
  remarksReport,
  isMandatoryEvidenceReady,
  mandatoryPhotoCount,
  isAnySlotUploading,
  isSubmittingReport,
  onChangeRemarks,
  onGoToPhotos,
  onSelectKendalaLapangan,
  onSubmitUnsuccessReport,
  onClose
}) => {
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<UnsuccessOptionKey | null>(null);
  const [selectedReasonId, setSelectedReasonId] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  const categories = useMemo(
    () => resolveUnsuccessCategories(hierarchicalStatuses),
    [hierarchicalStatuses]
  );

  const selectedCategory = useMemo(
    () => categories.find(c => c.key === selectedCategoryKey) || null,
    [categories, selectedCategoryKey]
  );

  const selectedReasonObj = useMemo(() => {
    if (!selectedCategory || selectedCategory.reasons.length === 0) return null;
    return (
      selectedCategory.reasons.find(r => r.id === selectedReasonId) || null
    );
  }, [selectedCategory, selectedReasonId]);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedCategoryKey(null);
    setSelectedReasonId('');
    setFormError(null);
  }, [isOpen, ticket.id]);

  const handleChooseCategory = (key: UnsuccessOptionKey) => {
    setFormError(null);
    if (key === 'kendala') {
      // Directly transition to existing KendalaReportModal without duplicating remarks fields
      onClose();
      onSelectKendalaLapangan();
      return;
    }

    setSelectedCategoryKey(key);
    const cat = categories.find(c => c.key === key);
    if (cat && cat.reasons.length === 1) {
      setSelectedReasonId(cat.reasons[0].id);
    } else {
      setSelectedReasonId('');
    }
  };

  const handleSave = async () => {
    if (isSubmittingReport || isAnySlotUploading) return;
    if (!selectedCategory || selectedCategory.flowType !== 'progress_report') {
      setFormError('Pilih kategori Unsuccess terlebih dahulu (Pending, Reschedule, Cancel, atau Kendala Lapangan).');
      return;
    }
    if (!selectedCategory.matchedStatus) {
      setFormError(
        `Status WO "${selectedCategory.title}" belum dikonfigurasi aktif pada Setting Droplist.`
      );
      return;
    }
    if (!selectedReasonObj) {
      setFormError(`Pilih alasan (Reason WO) untuk status ${selectedCategory.title}.`);
      return;
    }
    if (!remarksReport.trim()) {
      setFormError('Remarks wajib diisi untuk menjelaskan penyebab atau kondisi pekerjaan.');
      return;
    }
    if (!isMandatoryEvidenceReady) {
      setFormError(
        `Server SOP membutuhkan 3 foto bukti wajib (${mandatoryPhotoCount}/3 terunggah) untuk menyimpan report ${selectedCategory.title}. Lengkapi foto wajib atau gunakan opsi Kendala Lapangan (#ISSUE).`
      );
      return;
    }

    setFormError(null);
    await onSubmitUnsuccessReport({
      reportStatus: selectedCategory.matchedStatus.name,
      reportStatusId: selectedCategory.matchedStatus.id,
      reasonReport: selectedReasonObj.name,
      reasonReportId: selectedReasonObj.id,
      remarksReport: remarksReport.trim()
    });
  };

  const showRemarksAndReasons =
    selectedCategory && selectedCategory.flowType === 'progress_report';

  return (
    <ResponsiveModal
      isOpen={isOpen}
      onClose={onClose}
      title="STATUS WO UNSUCCESS"
      subtitle={`WO ${ticket.woNumber} • ${ticket.customerName}`}
      icon={<AlertTriangle className="w-4 h-4 text-[#9B2C37] dark:text-rose-300" />}
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
            disabled={
              isSubmittingReport ||
              isAnySlotUploading ||
              !showRemarksAndReasons
            }
            onClick={handleSave}
            data-testid="unsuccess-modal-save-btn"
            className={`mj-btn-installer-danger min-h-[48px] flex-[1.5] py-2.5 px-4 text-xs font-bold gap-1.5 cursor-pointer disabled:opacity-50 ${
              isSubmittingReport ? 'mj-btn-loading' : ''
            }`}
          >
            {isSubmittingReport ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )}
            <span>{isSubmittingReport ? 'Menyimpan...' : 'Simpan'}</span>
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 4 Category Cards */}
        <div className="space-y-2">
          <label className="block text-[11px] font-mono uppercase tracking-wider font-bold text-[#52647A] dark:text-[#C4B5D6]">
            Pilih Kategori Unsuccess *
          </label>
          <div className="grid grid-cols-1 gap-2">
            {categories.map(cat => {
              const isSelected = selectedCategoryKey === cat.key;
              return (
                <button
                  key={cat.key}
                  type="button"
                  data-testid={`unsuccess-option-${cat.key}`}
                  onClick={() => handleChooseCategory(cat.key)}
                  className={`w-full min-h-[54px] px-3.5 py-3 rounded-xl border text-left flex items-start justify-between gap-3 transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#FCE9EB] dark:bg-rose-950/55 border-[#D45B66] dark:border-rose-500 text-[#9B2C37] dark:text-rose-100 shadow-xs'
                      : 'bg-[#F8FAFD] dark:bg-[#1E1238] border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-[#E8DDFF] hover:border-[#D45B66]/65'
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        isSelected
                          ? 'bg-[#D45B66] dark:bg-rose-600 text-white'
                          : 'bg-[#FCE9EB] dark:bg-rose-950/60 text-[#9B2C37] dark:text-rose-300'
                      }`}
                    >
                      {OPTION_ICONS[cat.key]}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-extrabold leading-snug flex items-center gap-2 flex-wrap">
                        <span>{cat.title}</span>
                        {cat.flowType === 'kendala_modal' && (
                          <span className="px-1.5 py-0.5 rounded bg-[#FCE9EB] dark:bg-rose-900/60 text-[#9B2C37] dark:text-rose-200 font-mono text-[9.5px] font-bold">
                            Foto + #ISSUE
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] opacity-85 leading-snug mt-0.5">{cat.description}</p>
                    </div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-1 border ${
                      isSelected
                        ? 'bg-[#D45B66] dark:bg-rose-500 border-[#D45B66] dark:border-rose-500 text-white'
                        : 'border-[#CBD5E1] dark:border-[#4B386B]'
                    }`}
                  >
                    {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Sub-selection & Mandatory Remarks for Pending / Reschedule / Cancel */}
        {showRemarksAndReasons && (
          <div className="space-y-3 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E]">
            {selectedCategory.matchedStatus ? (
              <div className="space-y-2">
                <label className="block text-[11px] font-mono uppercase tracking-wider font-bold text-[#52647A] dark:text-[#C4B5D6]">
                  Reason WO ({selectedCategory.matchedStatus.name}) *
                </label>
                {selectedCategory.reasons.length === 0 ? (
                  <div className="p-3 rounded-xl bg-[#FFF2D9] dark:bg-amber-950/40 border border-[#F2CF95] dark:border-amber-800/60 text-xs text-[#9D661F] dark:text-amber-200">
                    Belum ada Reason WO aktif untuk status <strong>{selectedCategory.matchedStatus.name}</strong> di Setting Droplist.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5 max-h-[180px] overflow-y-auto pr-0.5">
                    {selectedCategory.reasons.map(reason => {
                      const active = selectedReasonId === reason.id;
                      return (
                        <button
                          key={reason.id}
                          type="button"
                          onClick={() => {
                            setSelectedReasonId(reason.id);
                            setFormError(null);
                          }}
                          className={`w-full min-h-[44px] px-3 py-2 rounded-xl border text-left text-xs font-semibold flex items-center justify-between gap-2 transition-all cursor-pointer ${
                            active
                              ? 'bg-[#FCE9EB] dark:bg-rose-950/50 border-[#D45B66] dark:border-rose-500 text-[#9B2C37] dark:text-rose-200 font-bold'
                              : 'bg-[#F8FAFD] dark:bg-[#1E1238] border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-[#E8DDFF]'
                          }`}
                        >
                          <span>{reason.name}</span>
                          {active && <CheckCircle2 className="w-4 h-4 shrink-0 text-[#D45B66] dark:text-rose-400" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-[#FCE9EB] dark:bg-rose-950/50 border border-[#F3C5CA] dark:border-rose-800/60 text-xs text-[#9B2C37] dark:text-rose-200">
                Status <strong>{selectedCategory.title}</strong> belum terdaftar aktif di konfigurasi Setting Droplist.
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="unsuccess-remarks-input"
                  className="block text-[11px] font-mono uppercase tracking-wider font-bold text-[#52647A] dark:text-[#C4B5D6]"
                >
                  Remarks *
                </label>
                <span className="font-mono text-[10px] text-[#8492A5] dark:text-[#A79BC0]">
                  {remarksReport.trim().length} karakter
                </span>
              </div>
              <textarea
                id="unsuccess-remarks-input"
                rows={3}
                value={remarksReport}
                disabled={isSubmittingReport}
                onChange={e => {
                  onChangeRemarks(e.target.value);
                  if (formError) setFormError(null);
                }}
                placeholder="Masukkan keterangan penyebab atau kondisi pekerjaan..."
                className="w-full px-3 py-2.5 rounded-xl bg-[#F8FAFD] dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] text-xs text-[#26364A] dark:text-[#f5eeff] placeholder:text-[#8492A5] dark:placeholder:text-[#A79BC0] focus:outline-none focus:ring-2 focus:ring-[#D45B66] dark:focus:ring-rose-500 resize-none"
              />
            </div>

            {!isMandatoryEvidenceReady && (
              <div className="p-3 rounded-xl bg-[#FFF2D9] dark:bg-amber-950/40 border border-[#F2CF95] dark:border-amber-800/60 space-y-2 text-xs text-[#9D661F] dark:text-amber-200">
                <div className="flex items-start gap-2">
                  <Camera className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Laporan status <strong>{selectedCategory.title}</strong> membutuhkan 3 foto bukti wajib ({mandatoryPhotoCount}/3). Jika terhalang di lokasi dan belum dapat mengambil 3 foto, pilih <strong>Kendala Lapangan</strong>.
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onGoToPhotos();
                    }}
                    className="mj-btn-installer-warning mj-btn-xs px-3 py-1.5 text-[11px] font-bold cursor-pointer"
                  >
                    Lengkapi Foto Wajib
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChooseCategory('kendala')}
                    className="mj-btn-installer-danger mj-btn-xs px-3 py-1.5 text-[11px] font-bold cursor-pointer"
                  >
                    Buka Kendala Lapangan
                  </button>
                </div>
              </div>
            )}
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
