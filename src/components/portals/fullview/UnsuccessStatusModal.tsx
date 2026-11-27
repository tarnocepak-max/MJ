import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CalendarClock,
  Camera,
  CheckCircle2,
  Clock,
  Loader2,
  X,
  XCircle
} from 'lucide-react';
import type { HierarchicalStatus, Ticket } from '../../../types/index.ts';
import { ResponsiveModal } from '../../common/ResponsiveModal';
import {
  SearchableReasonDropdown,
  type SearchableReasonAccentTone
} from './SearchableReasonDropdown';
import {
  getUnsuccessOptionSemanticStyles,
  resolveUnsuccessCategories,
  UnsuccessOptionKey
} from '../../../utils/fullviewWorkflow';
import { MIN_UNSUCCESS_PHOTO_EVIDENCE } from '../../../utils/photoEvidenceValidation';

export interface UnsuccessStatusModalProps {
  isOpen: boolean;
  ticket: Ticket;
  hierarchicalStatuses: HierarchicalStatus[];
  remarksReport: string;
  isMandatoryEvidenceReady: boolean;
  mandatoryPhotoCount: number;
  verifiedUploadedPhotoCount: number;
  isAnySlotUploading: boolean;
  isSubmittingReport: boolean;
  onChangeRemarks: (value: string) => void;
  onGoToPhotos: () => void;
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
  cancel: <XCircle className="w-4 h-4" />
};

const OPTION_DROPDOWN_TONES: Record<UnsuccessOptionKey, SearchableReasonAccentTone> = {
  pending: 'amber',
  reschedule: 'blue',
  cancel: 'red'
};

export const UnsuccessStatusModal: React.FC<UnsuccessStatusModalProps> = ({
  isOpen,
  ticket,
  hierarchicalStatuses,
  remarksReport,
  isMandatoryEvidenceReady,
  mandatoryPhotoCount,
  verifiedUploadedPhotoCount,
  isAnySlotUploading,
  isSubmittingReport,
  onChangeRemarks,
  onGoToPhotos,
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
    return selectedCategory.reasons.find(r => r.id === selectedReasonId) || null;
  }, [selectedCategory, selectedReasonId]);

  const isUnsuccessEvidenceReady =
    isMandatoryEvidenceReady && verifiedUploadedPhotoCount >= MIN_UNSUCCESS_PHOTO_EVIDENCE;

  useEffect(() => {
    if (!isOpen) return;
    setSelectedCategoryKey(null);
    setSelectedReasonId('');
    setFormError(null);
  }, [isOpen, ticket.id]);

  const handleChooseCategory = (key: UnsuccessOptionKey) => {
    setFormError(null);
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
      setFormError('Pilih kategori Unsuccess terlebih dahulu (Pending, Reschedule, atau Cancel).');
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
    if (!isUnsuccessEvidenceReady) {
      setFormError(
        `Laporan Unsuccess membutuhkan minimal 4 foto evidence, termasuk seluruh foto wajib. (Wajib ${mandatoryPhotoCount}/3, Foto Valid: ${verifiedUploadedPhotoCount}/7)`
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

  const activeCategoryTone = selectedCategoryKey
    ? getUnsuccessOptionSemanticStyles(selectedCategoryKey)
    : null;

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
              !selectedCategory ||
              !isUnsuccessEvidenceReady
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
        {/* Live Photo Evidence Readiness Counter for Unsuccess (Min 4 Valid incl. 3 Mandatory) */}
        <div className="flex items-center justify-between gap-2 flex-wrap px-3 py-2 rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[11px] font-mono">
          <span className="font-bold text-[#52647A] dark:text-[#C4B5D6]">
            Syarat Foto Unsuccess
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`px-2 py-0.5 rounded-full font-bold border ${
                isMandatoryEvidenceReady
                  ? 'bg-[#E4F5EC] dark:bg-emerald-950/60 text-[#218A63] dark:text-emerald-300 border-[#B7E4CC] dark:border-emerald-700'
                  : 'bg-[#FCE9EB] dark:bg-rose-950/60 text-[#9B2C37] dark:text-rose-300 border-[#F2BCC2] dark:border-rose-700'
              }`}
            >
              Wajib: {mandatoryPhotoCount}/3
            </span>
            <span
              data-testid="unsuccess-valid-photo-counter"
              className={`px-2 py-0.5 rounded-full font-bold border ${
                isUnsuccessEvidenceReady
                  ? 'bg-[#E4F5EC] dark:bg-emerald-950/60 text-[#218A63] dark:text-emerald-300 border-[#B7E4CC] dark:border-emerald-700'
                  : 'bg-[#FFF2D9] dark:bg-amber-950/60 text-[#9D661F] dark:text-amber-300 border-[#F2CF95] dark:border-amber-700'
              }`}
            >
              Foto Valid: {verifiedUploadedPhotoCount}/7
            </span>
          </div>
        </div>

        {/* Strictly 3 Level-1 Category Cards: Pending, Reschedule, Cancel */}
        <div className="space-y-2">
          <label className="block text-[11px] font-mono uppercase tracking-wider font-bold text-[#52647A] dark:text-[#C4B5D6]">
            Pilih Kategori Unsuccess *
          </label>
          <div className="grid grid-cols-1 gap-2">
            {categories.map(cat => {
              const isSelected = selectedCategoryKey === cat.key;
              const tone = getUnsuccessOptionSemanticStyles(cat.key);
              return (
                <button
                  key={cat.key}
                  type="button"
                  data-testid={`unsuccess-option-${cat.key}`}
                  onClick={() => handleChooseCategory(cat.key)}
                  className={`w-full min-h-[54px] px-3.5 py-3 rounded-xl border text-left flex items-start justify-between gap-3 transition-all cursor-pointer ${
                    isSelected ? tone.cardSelected : tone.cardIdle
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        isSelected ? tone.iconSelected : tone.iconIdle
                      }`}
                    >
                      {OPTION_ICONS[cat.key]}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-extrabold leading-snug flex items-center gap-2 flex-wrap">
                        <span>{cat.title}</span>
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-mono text-[9.5px] font-bold ${tone.badge}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                          <span>{cat.reasons.length} Alasan</span>
                        </span>
                      </div>
                      <p className="text-[11px] opacity-85 leading-snug mt-0.5">{cat.description}</p>
                    </div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-1 border ${
                      isSelected
                        ? tone.radioSelected
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

        {/* Level-2 Searchable Dropdown & Mandatory Remarks */}
        {selectedCategory && (
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
                  <SearchableReasonDropdown
                    reasons={selectedCategory.reasons}
                    selectedReasonId={selectedReasonObj?.id || selectedReasonId}
                    selectedReasonName={selectedReasonObj?.name}
                    accentTone={OPTION_DROPDOWN_TONES[selectedCategory.key]}
                    placeholder={`-- Pilih Alasan ${selectedCategory.title} (Level 2) --`}
                    searchPlaceholder="Cari alasan atau kategori pekerjaan..."
                    dataTestId="unsuccess-reason-dropdown"
                    onSelectReason={reason => {
                      setSelectedReasonId(reason.id);
                      setFormError(null);
                    }}
                  />
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
                className={`w-full px-3 py-2.5 rounded-xl bg-[#F8FAFD] dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] text-xs text-[#26364A] dark:text-[#f5eeff] placeholder:text-[#8492A5] dark:placeholder:text-[#A79BC0] focus:outline-none focus:ring-2 resize-none ${
                  activeCategoryTone?.focusRing || 'focus:ring-[#D45B66] dark:focus:ring-rose-500'
                }`}
              />
            </div>

            {!isUnsuccessEvidenceReady && (
              <div
                data-testid="unsuccess-photo-requirement-warning"
                className="p-3 rounded-xl bg-[#FFF2D9] dark:bg-amber-950/40 border border-[#F2CF95] dark:border-amber-800/60 flex items-center justify-between gap-2.5 text-xs text-[#9D661F] dark:text-amber-200"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <Camera className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Laporan Unsuccess membutuhkan minimal 4 foto evidence, termasuk seluruh foto wajib.{' '}
                    <strong className="font-mono">
                      (Wajib {mandatoryPhotoCount}/3 · Foto Valid: {verifiedUploadedPhotoCount}/7)
                    </strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onGoToPhotos();
                  }}
                  className="mj-btn-installer-warning mj-btn-xs px-3 py-1.5 text-[11px] font-bold shrink-0 cursor-pointer"
                >
                  Lengkapi Foto
                </button>
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
