import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ImagePlus,
  Loader2,
  RefreshCw,
  Send,
  Trash2,
  X
} from 'lucide-react';
import { Ticket } from '../../types/index.ts';
import { useApp } from '../../context/AppContext';
import { ResponsiveModal } from '../common/ResponsiveModal';
import { safeSessionStorageRemove, safeSessionStorageSet } from '../../utils/safeStorage';

export interface KendalaReportModalProps {
  isOpen: boolean;
  ticket: Ticket | null;
  onClose: () => void;
  onSubmitted?: () => void;
}

interface KendalaDraftState {
  reasonId: string;
  description: string;
  photoDataUrl: string;
  photoFileName: string;
  photoMimeType: string;
  savedAt: string;
}

const KENDALA_REASONS = [
  { id: 'cust_unreachable', label: 'Customer Tidak Ada di Lokasi / Tidak Merespons', status: 'Pending Technical' as const },
  { id: 'access_restricted', label: 'Akses Gedung / Perumahan / Izin Terbatas', status: 'Pending Technical' as const },
  { id: 'fat_full_issue', label: 'FAT Penuh / Port Tidak Tersedia / Redaman Tinggi', status: 'Pending Technical' as const },
  { id: 'weather_safety', label: 'Cuaca Buruk / Kondisi Lapangan Tidak Aman', status: 'Pending Technical' as const },
  { id: 'cust_reschedule', label: 'Pelanggan Meminta Reschedule Jadwal', status: 'Pending Technical' as const },
  { id: 'technical_other', label: 'Kendala Teknis / Material Lapangan Lainnya', status: 'Pending Technical' as const }
];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

async function compressKendalaImageFile(file: File): Promise<{ dataUrl: string; mimeType: string; fileName: string }> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.readAsDataURL(file);
  });

  if (!file.type.startsWith('image/')) {
    throw new Error('File harus berupa gambar (JPG, PNG, atau WebP).');
  }

  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const maxDim = 1600;
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ dataUrl: rawDataUrl, mimeType: 'image/jpeg', fileName: file.name || 'kendala.jpg' });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.82);
        const baseName = (file.name || 'kendala').replace(/\.[^.]+$/, '');
        resolve({
          dataUrl: compressed,
          mimeType: 'image/jpeg',
          fileName: `${baseName}.jpg`
        });
      } catch {
        resolve({ dataUrl: rawDataUrl, mimeType: file.type || 'image/jpeg', fileName: file.name || 'kendala.jpg' });
      }
    };
    img.onerror = () => {
      resolve({ dataUrl: rawDataUrl, mimeType: file.type || 'image/jpeg', fileName: file.name || 'kendala.jpg' });
    };
    img.src = rawDataUrl;
  });
}

export const KendalaReportModal: React.FC<KendalaReportModalProps> = ({
  isOpen,
  ticket,
  onClose,
  onSubmitted
}) => {
  const { currentUser, submitKendalaReport, toast } = useApp();

  const [selectedReasonId, setSelectedReasonId] = useState<string>(KENDALA_REASONS[0].id);
  const [description, setDescription] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [photoFileName, setPhotoFileName] = useState('');
  const [photoMimeType, setPhotoMimeType] = useState('image/jpeg');
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const submitLockRef = useRef(false);

  const draftStorageKey =
    ticket && currentUser?.id
      ? `morajaws_kendala_draft_${currentUser.id}_${ticket.id}`
      : ticket
      ? `morajaws_kendala_draft_anon_${ticket.id}`
      : '';

  // Restore session draft whenever modal opens for a ticket
  useEffect(() => {
    if (!isOpen || !ticket) return;
    setFormError(null);
    setIsPreviewExpanded(false);
    submitLockRef.current = false;
    setIsSubmitting(false);

    if (draftStorageKey && typeof window !== 'undefined') {
      try {
        const raw = window.sessionStorage.getItem(draftStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<KendalaDraftState>;
          setSelectedReasonId(parsed.reasonId || KENDALA_REASONS[0].id);
          setDescription(parsed.description || '');
          setPhotoDataUrl(parsed.photoDataUrl || '');
          setPhotoFileName(parsed.photoFileName || '');
          setPhotoMimeType(parsed.photoMimeType || 'image/jpeg');
          setRestoredFromDraft(Boolean(parsed.description || parsed.photoDataUrl));
          return;
        }
      } catch {
        // Ignore corrupt draft
      }
    }

    setSelectedReasonId(KENDALA_REASONS[0].id);
    setDescription('');
    setPhotoDataUrl('');
    setPhotoFileName('');
    setPhotoMimeType('image/jpeg');
    setRestoredFromDraft(false);
  }, [isOpen, ticket?.id, draftStorageKey]);

  if (!isOpen || !ticket) return null;

  const persistDraftToSession = () => {
    if (!draftStorageKey || typeof window === 'undefined') return;
    const hasContent = Boolean(description.trim());
    if (!hasContent) {
      safeSessionStorageRemove(draftStorageKey);
      return;
    }
    // Never write large Base64 photoDataUrl blobs into browser sessionStorage/localStorage
    safeSessionStorageSet(
      draftStorageKey,
      JSON.stringify({
        reasonId: selectedReasonId,
        description,
        photoDataUrl: '',
        photoFileName: photoFileName || '',
        photoMimeType: photoMimeType || 'image/jpeg',
        savedAt: new Date().toISOString()
      })
    );
  };

  const clearDraftFromSession = () => {
    if (!draftStorageKey) return;
    safeSessionStorageRemove(draftStorageKey);
  };

  const handleBack = () => {
    if (isSubmitting) return;
    persistDraftToSession();
    onClose();
  };

  const handleImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setFormError(null);
    setIsProcessingImage(true);
    try {
      const processed = await compressKendalaImageFile(file);
      const base64Part = processed.dataUrl.split(',')[1] || '';
      const approxBytes = Math.floor((base64Part.length * 3) / 4);
      if (approxBytes > MAX_IMAGE_BYTES) {
        setFormError('Ukuran foto terlalu besar (> 5MB) bahkan setelah kompresi. Gunakan foto lain.');
        return;
      }
      setPhotoDataUrl(processed.dataUrl);
      setPhotoFileName(processed.fileName);
      setPhotoMimeType(processed.mimeType);
    } catch (err: any) {
      setFormError(err?.message || 'Gagal memproses foto bukti kendala.');
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleRemovePhoto = () => {
    setPhotoDataUrl('');
    setPhotoFileName('');
    setIsPreviewExpanded(false);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (submitLockRef.current || isSubmitting || isProcessingImage) return;

    const trimmedDesc = description.trim();
    if (trimmedDesc.length < 5) {
      setFormError('Keterangan kendala wajib diisi minimal 5 karakter agar dapat ditindaklanjuti Leader & Dispatch.');
      return;
    }
    if (!photoDataUrl) {
      setFormError('Foto bukti kendala wajib diunggah sebelum mengirim laporan.');
      return;
    }

    const reasonObj = KENDALA_REASONS.find(r => r.id === selectedReasonId) || KENDALA_REASONS[0];
    submitLockRef.current = true;
    setIsSubmitting(true);
    setFormError(null);

    try {
      const res = await submitKendalaReport(ticket.id, {
        reasonId: reasonObj.id,
        reasonLabel: reasonObj.label,
        description: trimmedDesc,
        fileData: photoDataUrl,
        fileName: photoFileName || `kendala_${ticket.woNumber}.jpg`,
        mimeType: photoMimeType || 'image/jpeg',
        targetInstallerStatus: reasonObj.status
      });

      if (!res.success) {
        setFormError(res.error || 'Gagal mengirim laporan kendala ke server.');
        return;
      }

      clearDraftFromSession();
      onSubmitted?.();
      onClose();
    } catch (err: any) {
      const msg = err?.message || 'Terjadi kesalahan saat mengirim laporan kendala.';
      setFormError(msg);
      toast.error(msg, 'Laporan Kendala Gagal');
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const isSubmitReady = description.trim().length >= 5 && Boolean(photoDataUrl) && !isProcessingImage && !isSubmitting;

  return (
    <ResponsiveModal
      isOpen={isOpen}
      onClose={handleBack}
      title="Laporan Kendala Lapangan"
      subtitle={`WO ${ticket.woNumber} • ${ticket.customerName}`}
      icon={<AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-300" />}
      size="md"
      mobileVariant="sheet"
      variant="dark_purple"
      closeOnBackdropClick={false}
      zIndexClass="z-80"
      footer={
        <div className="w-full flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleBack}
            disabled={isSubmitting}
            className="mj-btn-installer-neutral min-h-[44px] flex-1 py-2.5 px-3 text-xs font-bold gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>KEMBALI</span>
          </button>
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={!isSubmitReady}
            className={`mj-btn-installer-danger min-h-[44px] flex-[1.5] py-2.5 px-4 text-xs font-bold gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              isSubmitting ? 'mj-btn-loading' : ''
            }`}
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span>{isSubmitting ? 'Mengirim...' : 'Submit Laporan Kendala'}</span>
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {restoredFromDraft && (
          <div className="p-2.5 rounded-xl bg-[#EAE8FF] dark:bg-[#2A194B] border border-[#DCE3F2] dark:border-[#4B386B] flex items-center justify-between gap-2 text-xs text-[#5145A6] dark:text-[#DAB9FF]">
            <span className="font-semibold">Draft kendala sebelumnya dipulihkan.</span>
            <button
              type="button"
              onClick={() => {
                setSelectedReasonId(KENDALA_REASONS[0].id);
                setDescription('');
                setPhotoDataUrl('');
                setPhotoFileName('');
                setRestoredFromDraft(false);
                clearDraftFromSession();
              }}
              className="text-[11px] font-bold underline cursor-pointer shrink-0"
            >
              Reset Draft
            </button>
          </div>
        )}

        <div className="p-3 rounded-xl bg-[#FFF2D9] dark:bg-amber-950/40 border border-[#F2CF95] dark:border-amber-700/60 text-xs text-[#9D661F] dark:text-amber-200 leading-relaxed">
          Laporan kendala wajib dilengkapi <strong>keterangan detail</strong> dan <strong>foto bukti lapangan</strong> agar langsung diteruskan ke Leader, Dispatch, serta LiveChat <strong>#ISSUE</strong>. Menekan <strong>KEMBALI</strong> hanya menyimpan draft dan tidak mengubah status WO.
        </div>

        {/* Alasan Kendala */}
        <div className="space-y-2">
          <label className="block text-[11px] font-mono uppercase tracking-wider font-bold text-[#52647A] dark:text-[#C4B5D6]">
            Kategori / Jenis Kendala *
          </label>
          <div className="grid grid-cols-1 gap-1.5">
            {KENDALA_REASONS.map(reason => {
              const isSelected = selectedReasonId === reason.id;
              return (
                <button
                  key={reason.id}
                  type="button"
                  onClick={() => setSelectedReasonId(reason.id)}
                  className={`w-full min-h-[44px] px-3 py-2 rounded-xl border text-left text-xs font-semibold flex items-center justify-between gap-2 transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#FCE9EB] dark:bg-rose-950/50 border-[#D45B66] dark:border-rose-500 text-[#9B2C37] dark:text-rose-200 font-bold'
                      : 'bg-[#F8FAFD] dark:bg-[#1E1238] border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-[#E8DDFF] hover:border-[#C5BEEF]'
                  }`}
                >
                  <span>{reason.label}</span>
                  {isSelected && <CheckCircle2 className="w-4 h-4 shrink-0 text-[#D45B66] dark:text-rose-400" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Keterangan Kendala */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="kendala-description-input"
              className="block text-[11px] font-mono uppercase tracking-wider font-bold text-[#52647A] dark:text-[#C4B5D6]"
            >
              Keterangan Kendala *
            </label>
            <span className="text-[10px] font-mono text-[#8492A5] dark:text-[#A79BC0]">
              {description.trim().length} karakter (min. 5)
            </span>
          </div>
          <textarea
            id="kendala-description-input"
            rows={3}
            value={description}
            onChange={e => {
              setDescription(e.target.value);
              if (formError) setFormError(null);
            }}
            placeholder="Jelaskan kronologi kendala di lokasi (misal: rumah terkunci, nomor tidak aktif, tiang FAT penuh 8/8 port, atau pelanggan minta dijadwalkan ulang)..."
            className="w-full px-3 py-2.5 rounded-xl bg-[#F8FAFD] dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] text-xs text-[#26364A] dark:text-[#f5eeff] placeholder:text-[#8492A5] dark:placeholder:text-[#A79BC0] focus:outline-none focus:ring-2 focus:ring-[#D45B66] dark:focus:ring-rose-500 resize-none"
          />
        </div>

        {/* Foto Bukti Kendala */}
        <div className="space-y-2">
          <label className="block text-[11px] font-mono uppercase tracking-wider font-bold text-[#52647A] dark:text-[#C4B5D6]">
            Foto Bukti Kendala *
          </label>

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/jpg"
            capture="environment"
            onChange={handleImageSelected}
            className="hidden"
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/jpg"
            onChange={handleImageSelected}
            className="hidden"
          />

          {photoDataUrl ? (
            <div className="rounded-xl border border-[#DDE6F0] dark:border-[#35105E] bg-[#F8FAFD] dark:bg-[#1E1238] p-2.5 space-y-2.5">
              <div className="relative rounded-lg overflow-hidden border border-[#DDE6F0] dark:border-[#35105E] bg-white dark:bg-[#160D29]">
                <img
                  src={photoDataUrl}
                  alt="Preview Foto Bukti Kendala"
                  onClick={() => setIsPreviewExpanded(prev => !prev)}
                  className={`w-full object-contain cursor-pointer transition-all ${
                    isPreviewExpanded ? 'max-h-[360px]' : 'max-h-[190px] object-cover'
                  }`}
                />
                <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-emerald-600/90 text-white text-[10px] font-mono font-bold shadow">
                  Foto Siap Diunggah
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 text-[11px] text-[#52647A] dark:text-[#C4B5D6]">
                <span className="font-mono truncate">{photoFileName || 'kendala.jpg'}</span>
                <button
                  type="button"
                  onClick={() => setIsPreviewExpanded(prev => !prev)}
                  className="font-semibold text-[#5145A6] dark:text-[#DAB9FF] underline shrink-0 cursor-pointer"
                >
                  {isPreviewExpanded ? 'Perkecil Preview' : 'Perbesar Preview'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isProcessingImage || isSubmitting}
                  onClick={() => cameraInputRef.current?.click()}
                  className="mj-btn-installer-neutral min-h-[44px] py-2 px-3 text-xs font-bold gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Ganti Foto</span>
                </button>
                <button
                  type="button"
                  disabled={isProcessingImage || isSubmitting}
                  onClick={handleRemovePhoto}
                  className="min-h-[44px] py-2 px-3 rounded-xl border border-[#F3C5CA] dark:border-rose-800 bg-[#FCE9EB] dark:bg-rose-950/50 text-[#9B2C37] dark:text-rose-200 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus Foto</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border-2 border-dashed border-[#C5BEEF] dark:border-[#4B386B] bg-[#F8FAFD] dark:bg-[#1E1238] p-4 space-y-3 text-center">
              <div className="w-10 h-10 rounded-full bg-[#FCE9EB] dark:bg-rose-950/60 text-[#D45B66] dark:text-rose-300 mx-auto flex items-center justify-center">
                {isProcessingImage ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
              </div>
              <p className="text-xs text-[#52647A] dark:text-[#C4B5D6]">
                {isProcessingImage
                  ? 'Memproses & mengompresi foto bukti...'
                  : 'Ambil foto kondisi lokasi/kendala langsung dari kamera atau pilih dari galeri.'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isProcessingImage || isSubmitting}
                  onClick={() => cameraInputRef.current?.click()}
                  className="mj-btn-installer-primary min-h-[44px] py-2.5 px-3 text-xs font-bold gap-1.5 cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>Ambil Foto Kamera</span>
                </button>
                <button
                  type="button"
                  disabled={isProcessingImage || isSubmitting}
                  onClick={() => galleryInputRef.current?.click()}
                  className="mj-btn-installer-neutral min-h-[44px] py-2.5 px-3 text-xs font-bold gap-1.5 cursor-pointer"
                >
                  <ImagePlus className="w-4 h-4" />
                  <span>Pilih dari Galeri</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {formError && (
          <div className="p-2.5 rounded-xl bg-[#FCE9EB] dark:bg-rose-950/60 border border-[#F3C5CA] dark:border-rose-700 text-[#9B2C37] dark:text-rose-200 text-xs font-medium flex items-start gap-2">
            <X className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{formError}</span>
          </div>
        )}
      </form>
    </ResponsiveModal>
  );
};
