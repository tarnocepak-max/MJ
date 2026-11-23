import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Ticket,
  TicketStatusWOInstaller,
  ChatAttachment
} from '../../types/index.ts';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { isTicketClosed } from '../../services/woLifecycleService';
import { getSafePreviewUrl } from '../../services/storageCompatibility';
import { useVisualViewportModal } from '../../hooks/useVisualViewportModal';
import {
  X,
  MapPin,
  Wrench,
  PauseCircle,
  FileCheck2,
  Camera,
  CheckCircle2,
  PenTool,
  RotateCcw,
  FileText,
  Send,
  AlertCircle,
  Loader2,
  UserCheck,
  MessageSquare
} from 'lucide-react';

interface WorkOrderQuickUpdateSheetProps {
  ticket: Ticket | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenFullReport?: (ticket: Ticket) => void;
}

interface StatusOptionConfig {
  value: TicketStatusWOInstaller;
  label: string;
  description: string;
  badge?: string;
  tone: 'default' | 'recommended' | 'warning';
  icon: React.FC<{ className?: string }>;
}

const INSTALLER_STATUS_CHOICES: StatusOptionConfig[] = [
  {
    value: 'On Site',
    label: 'On Site / Tiba di Lokasi',
    description: 'Teknisi sudah tiba dan koordinasi akses lokasi / FAT',
    tone: 'default',
    icon: MapPin
  },
  {
    value: 'In Progress',
    label: 'Dalam Pengerjaan',
    description: 'Penarikan dropcore, pemasangan ONT & pengujian redaman',
    badge: 'Aktif',
    tone: 'recommended',
    icon: Wrench
  },
  {
    value: 'Pending Technical',
    label: 'Tunda / Kendala Lapangan',
    description: 'Kendala izin lokasi, port FAT penuh, atau permintaan reschedule',
    tone: 'warning',
    icon: PauseCircle
  }
];

function compressImageToDataUrl(file: File, maxDim = 1280, quality = 0.78): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const src = String(reader.result || '');
      const img = new Image();
      img.onerror = () => resolve(src);
      img.onload = () => {
        try {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;
          const scale = Math.min(1, maxDim / Math.max(width, height, 1));
          const targetW = Math.max(1, Math.round(width * scale));
          const targetH = Math.max(1, Math.round(height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(src);
            return;
          }
          ctx.drawImage(img, 0, 0, targetW, targetH);
          resolve(canvas.toDataURL('image/jpeg', quality) || src);
        } catch {
          resolve(src);
        }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return 'Tersimpan';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const WorkOrderQuickUpdateSheet: React.FC<WorkOrderQuickUpdateSheetProps> = ({
  ticket,
  isOpen,
  onClose,
  onOpenFullReport
}) => {
  const {
    currentUser,
    updateTicketStatus,
    updateTicket,
    sendTicketMessage,
    getMessagesForTicket
  } = useApp();
  const { toast } = useToast();

  const [selectedStatus, setSelectedStatus] = useState<TicketStatusWOInstaller>('In Progress');
  const [notes, setNotes] = useState('');
  const [syncToLiveChat, setSyncToLiveChat] = useState(true);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isCompressingPhoto, setIsCompressingPhoto] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Digital Signature state
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState('');
  const [hasNewSignatureStroke, setHasNewSignatureStroke] = useState(false);
  const [signerName, setSignerName] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen || !ticket) return;
    const initialStatus: TicketStatusWOInstaller =
      ticket.statusWOInstaller &&
      ['On Site', 'In Progress', 'Pending Technical'].includes(ticket.statusWOInstaller)
        ? ticket.statusWOInstaller
        : 'In Progress';
    setSelectedStatus(initialStatus);
    setNotes(ticket.remarksWOInstaller || '');
    setSyncToLiveChat(currentUser.role !== 'leader');
    setAttachments([]);
    setSignatureDataUrl(
      ticket.customerSignatureUrl || ticket.technicalReport?.customerSignatureUrl || ''
    );
    setHasNewSignatureStroke(false);
    setSignerName(ticket.customerName || '');
  }, [isOpen, ticket?.id, currentUser.role]);

  const messages = useMemo(() => {
    if (!ticket) return [];
    return getMessagesForTicket(ticket.id);
  }, [ticket, getMessagesForTicket]);

  const hasProgressCheckIn = useMemo(() => {
    if (!ticket) return false;
    if (ticket.checkInAt) return true;
    return messages.some(
      m =>
        String(m.category || '').trim().toUpperCase() === 'PROGRESS' &&
        !String(m.id || '').startsWith('temp_')
    );
  }, [ticket, messages]);

  const { viewportHeight, keyboardInset } = useVisualViewportModal(isOpen);

  if (!isOpen || !ticket) return null;

  const ticketClosed = isTicketClosed(ticket);
  const canSendChat = currentUser.role !== 'leader';
  const isReadOnlyLeader = currentUser.role === 'leader';

  const existingPhotoUrls = Array.from(
    new Set(
      [
        ...(ticket.technicalReport?.photos || []),
        ticket.technicalReport?.photoBeforeUrl,
        ticket.technicalReport?.photoAfterUrl
      ].filter((u): u is string => Boolean(u && typeof u === 'string' && u.trim()))
    )
  );

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remainingSlots = Math.max(0, 5 - attachments.length);
    if (remainingSlots === 0) {
      toast.warning('Maksimal 5 foto baru per pengiriman log.', 'Batas Lampiran');
      return;
    }

    setIsCompressingPhoto(true);
    try {
      const slice = Array.from(files).slice(0, remainingSlots);
      const nextAtts: ChatAttachment[] = [];
      for (const file of slice) {
        if (!file.type.startsWith('image/')) continue;
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`Ukuran "${file.name}" melebihi batas 10MB.`);
          continue;
        }
        const url = await compressImageToDataUrl(file);
        nextAtts.push({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          url,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type
        });
      }
      if (nextAtts.length > 0) {
        setAttachments(prev => [...prev, ...nextAtts]);
        toast.info(`${nextAtts.length} foto siap dilampirkan.`);
      }
    } finally {
      setIsCompressingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Signature canvas handlers
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (ticketClosed || isReadOnlyLeader) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    const { x, y } = getCanvasPoint(e);
    ctx.strokeStyle = document.documentElement.classList.contains('dark') ? '#E9D5FF' : '#26364A';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || ticketClosed || isReadOnlyLeader) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCanvasPoint(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {}
    try {
      const dataUrl = canvas.toDataURL('image/png');
      setSignatureDataUrl(dataUrl);
      setHasNewSignatureStroke(true);
    } catch {}
  };

  const handleResetSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    setSignatureDataUrl('');
    setHasNewSignatureStroke(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || ticketClosed || isReadOnlyLeader) return;

    const cleanNotes = notes.trim();
    if (!cleanNotes && attachments.length === 0 && selectedStatus === ticket.statusWOInstaller) {
      toast.warning('Isi catatan progres atau pilih perubahan status sebelum menyimpan.');
      return;
    }

    setIsSubmitting(true);
    try {
      const finalRemarks = cleanNotes || `Status diperbarui menjadi ${selectedStatus}`;

      // 1. Update Ticket Status & Remarks
      updateTicketStatus(ticket.id, undefined, selectedStatus, finalRemarks);

      // 2. Persist signature URL if customer signed on-site
      if (hasNewSignatureStroke && signatureDataUrl) {
        updateTicket(
          ticket.id,
          {
            customerSignatureUrl: signatureDataUrl
          },
          signerName.trim()
            ? `Tanda tangan PIC/Pelanggan (${signerName.trim()}) disimpan`
            : 'Tanda tangan PIC/Pelanggan disimpan'
        );
      }

      // 3. Send LiveChat log (triggers PROGRESS Check-in for installer when category=PROGRESS)
      if (canSendChat && (syncToLiveChat || attachments.length > 0)) {
        const chatCat = selectedStatus === 'Pending Technical' ? 'ISSUE' : 'PROGRESS';
        const chatBody = `[Status: ${selectedStatus}] ${finalRemarks}${
          signerName.trim() && hasNewSignatureStroke ? ` · PIC Sign-off: ${signerName.trim()}` : ''
        }`;
        const chatRes = await sendTicketMessage(ticket.id, chatBody, attachments, chatCat);
        if (!chatRes.success && chatRes.error) {
          toast.warning(chatRes.error, 'Status Disimpan (Chat Tertunda)');
        }
      }

      toast.success(
        `Status WO ${ticket.woNumber} diperbarui ke "${selectedStatus}".`,
        'Work Order Diperbarui',
        { withSound: true }
      );
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Gagal memperbarui status Work Order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wo-quick-update-title"
      style={keyboardInset > 0 ? { paddingBottom: `${keyboardInset}px` } : undefined}
      className="fixed inset-0 z-65 flex items-end sm:items-center justify-center bg-[#26364A]/45 dark:bg-[#160D29]/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <section
        onClick={e => e.stopPropagation()}
        style={
          viewportHeight
            ? { maxHeight: `${Math.max(320, Math.min(Math.round(viewportHeight * 0.94), window.innerHeight - 12))}px` }
            : undefined
        }
        className="mj-sheet-enter w-full sm:max-w-lg bg-white/95 dark:bg-[#1E1238] rounded-t-[28px] sm:rounded-2xl shadow-2xl border border-[#DDE6F0] dark:border-[#35105E] max-h-[92dvh] flex flex-col overflow-hidden"
      >
        {/* Drag Handle & Sticky Header */}
        <header className="sticky top-0 z-20 bg-[#F8FAFD] dark:bg-[#160D29] pt-3 pb-3 px-4 border-b border-[#DDE6F0] dark:border-[#35105E] shrink-0">
          <div
            aria-hidden="true"
            className="w-12 h-1.5 rounded-full bg-[#CFDCE8] dark:bg-[#4B386B] mx-auto mb-3 sm:hidden"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 pr-2">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#6657C8] dark:bg-[#DAB9FF] shrink-0" />
                <h2
                  id="wo-quick-update-title"
                  className="font-display text-[16px] font-bold text-[#26364A] dark:text-white truncate"
                >
                  Update Status Work Order
                </h2>
              </div>
              <p className="font-mono text-[11px] font-semibold text-[#52647A] dark:text-[#C5B3DF] truncate mt-0.5">
                {ticket.woNumber} • {ticket.customerName}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup form update"
              className="btn-3d-icon w-11 h-11 min-w-[44px] min-h-[44px] rounded-full cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Scrollable Sheet Body */}
        <form id="wo-quick-update-form" onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-5">
          {ticketClosed && (
            <div className="mj-tactile-well p-3 rounded-xl text-[#52647A] dark:text-[#CEC0E8] text-xs font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-[#5145A6] dark:text-[#DAB9FF]" />
              <span>Work Order ini berstatus CLOSED dan bersifat read-only.</span>
            </div>
          )}

          {isReadOnlyLeader && (
            <div className="p-3 rounded-xl bg-[#FFF2D9] dark:bg-amber-950/50 border border-[#F2CF95] dark:border-amber-800 text-[#9D661F] dark:text-amber-200 text-xs font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Role Leader hanya dapat memantau progres. Perubahan status dilakukan Teknisi atau Dispatch.</span>
            </div>
          )}

          {/* Field 1: Touch-Friendly Radio Status Options */}
          <fieldset className="flex flex-col gap-2" disabled={ticketClosed || isReadOnlyLeader}>
            <legend className="text-xs font-bold text-[#26364A] dark:text-white mb-1 flex items-center justify-between w-full">
              <span>
                Pilih Status Eksekusi Lapangan <span className="text-[#D45B66]">*</span>
              </span>
              <span className="text-[10px] font-bold text-[#5145A6] dark:text-[#DAB9FF] bg-[#EAE8FF] dark:bg-[#2E1459] px-2 py-0.5 rounded-full border border-[#DCE3F2] dark:border-[#5B35B1]">
                Wajib Diisi
              </span>
            </legend>

            {INSTALLER_STATUS_CHOICES.map(opt => {
              const Icon = opt.icon;
              const isChecked = selectedStatus === opt.value;
              const isWarn = opt.tone === 'warning';

              return (
                <label
                  key={opt.value}
                  className={`relative flex items-center justify-between min-h-[54px] p-3 rounded-xl cursor-pointer transition-all border ${
                    isWarn
                      ? isChecked
                        ? 'bg-[#FCE9EB] dark:bg-rose-950/70 border-[#D45B66] dark:border-rose-500 ring-2 ring-[#D45B66]/25 dark:ring-rose-500/25'
                        : 'bg-[#FCE9EB]/55 dark:bg-rose-950/30 border-[#F3C5CA] dark:border-rose-900/50 hover:bg-[#FCE9EB] dark:hover:bg-rose-950/40'
                      : isChecked
                      ? 'bg-[#EAE8FF] dark:bg-[#2E1459] border-[#6657C8] dark:border-[#7135B5] ring-2 ring-[#6657C8]/25 dark:ring-[#7135B5]/25 shadow-2xs'
                      : 'bg-[#F8FAFD] dark:bg-[#160D29] border-[#DDE6F0] dark:border-[#35105E] hover:bg-[#EAE8FF]/60 dark:hover:bg-[#241145]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    <Icon
                      className={`w-5 h-5 shrink-0 ${
                        isWarn
                          ? 'text-[#D45B66] dark:text-rose-300'
                          : isChecked
                          ? 'text-[#5145A6] dark:text-[#DAB9FF]'
                          : 'text-[#8492A5] dark:text-[#C5B3DF]'
                      }`}
                    />
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`text-[13.5px] font-bold ${
                            isWarn
                              ? 'text-[#9B2C37] dark:text-rose-200'
                              : 'text-[#26364A] dark:text-white'
                          }`}
                        >
                          {opt.label}
                        </span>
                        {opt.badge && (
                          <span className="bg-[#6657C8] dark:bg-[#58149C] text-white text-[9.5px] font-bold px-2 py-0.5 rounded-full">
                            {opt.badge}
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-[11px] leading-snug ${
                          isWarn
                            ? 'text-[#9B2C37]/80 dark:text-rose-300/80'
                            : 'text-[#52647A] dark:text-[#C5B3DF]'
                        }`}
                      >
                        {opt.description}
                      </span>
                    </div>
                  </div>
                  <input
                    type="radio"
                    name="wo_quick_status"
                    value={opt.value}
                    checked={isChecked}
                    onChange={() => setSelectedStatus(opt.value)}
                    className={`w-5 h-5 shrink-0 cursor-pointer ${
                      isWarn ? 'accent-[#D45B66] dark:accent-rose-600' : 'accent-[#6657C8] dark:accent-[#58149C]'
                    }`}
                  />
                </label>
              );
            })}

            {onOpenFullReport && !ticketClosed && !isReadOnlyLeader && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenFullReport(ticket);
                }}
                className="btn-3d-lilac flex items-center justify-between min-h-[54px] p-3 rounded-xl text-left cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <FileCheck2 className="w-5 h-5 text-[#5145A6] dark:text-[#DAB9FF] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-[#5145A6] dark:text-[#DAB9FF]">
                      Buka Form Technical Report Lengkap &amp; QC
                    </div>
                    <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] truncate">
                      {hasProgressCheckIn
                        ? 'Check-in #PROGRESS aktif — siap isi Status & Reason WO serta Redaman OPM'
                        : 'Membutuhkan Check-in #PROGRESS & verifikasi min. 3 foto bukti wajib SOP'}
                    </div>
                  </div>
                </div>
                <span className="text-[11px] font-bold text-[#5145A6] dark:text-[#DAB9FF] shrink-0 ml-2">
                  Buka →
                </span>
              </button>
            )}
          </fieldset>

          {/* Field 2: Progress Notes & LiveChat Sync */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="quick-update-notes"
              className="text-xs font-bold text-[#26364A] dark:text-white flex items-center justify-between"
            >
              <span className="flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF]" />
                <span>Catatan Progres Lapangan &amp; Temuan Teknis</span>
              </span>
              <span className="text-[#D45B66]">*</span>
            </label>

            <div className="tactile-debossed-input rounded-xl p-3 focus-within:ring-2 focus-within:ring-[#6657C8]/40 dark:focus-within:ring-[#7135B5]/40 transition-all">
              <textarea
                id="quick-update-notes"
                rows={3}
                maxLength={500}
                disabled={ticketClosed || isReadOnlyLeader}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Tuliskan progres pemasangan dropcore, akses FAT, hasil pengukuran OPM, atau kendala..."
                className="w-full bg-transparent text-xs text-[#26364A] dark:text-white placeholder:text-[#8492A5] dark:placeholder:text-[#C5B3DF] focus:outline-none resize-none leading-relaxed"
              />
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E] text-[10.5px] font-semibold text-[#52647A] dark:text-[#CEC0E8]">
                <span className="flex items-center gap-1 text-[#5145A6] dark:text-[#DAB9FF]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>
                    {hasProgressCheckIn
                      ? 'Check-in #PROGRESS terverifikasi'
                      : syncToLiveChat && selectedStatus !== 'Pending Technical'
                      ? 'Akan memicu Check-in #PROGRESS otomatis'
                      : 'Tersimpan ke log Work Order'}
                  </span>
                </span>
                <span className="font-mono tabular-nums">{notes.length} / 500</span>
              </div>
            </div>
          </div>

          {/* Field 3: Evidence Upload (Real Photos + Compression) */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[#26364A] dark:text-white flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF]" />
                <span>
                  Lampiran Bukti Kerja ({attachments.length}/5 baru
                  {existingPhotoUrls.length > 0 ? ` • ${existingPhotoUrls.length} tersimpan` : ''})
                </span>
              </label>
              <span className="text-[10.5px] font-mono text-[#8492A5] dark:text-[#C5B3DF]">Maks 10MB</span>
            </div>

            {attachments.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {attachments.map(att => (
                  <div
                    key={att.id}
                    className="relative bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] rounded-xl overflow-hidden shadow-xs"
                  >
                    <img
                      src={getSafePreviewUrl(att.url)}
                      alt={att.fileName}
                      className="w-full h-24 object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#26364A]/85 via-[#26364A]/20 to-transparent dark:from-[#160D29]/85 dark:via-[#160D29]/20 flex flex-col justify-between p-2">
                      <button
                        type="button"
                        onClick={() => setAttachments(prev => prev.filter(item => item.id !== att.id))}
                        aria-label={`Hapus ${att.fileName}`}
                        className="self-end w-8 h-8 bg-[#26364A]/80 dark:bg-[#160D29]/80 rounded-full flex items-center justify-center text-white cursor-pointer hover:bg-[#D45B66]"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[10px] text-white font-semibold truncate">{att.fileName}</span>
                        <span className="text-[9.5px] text-[#DDF4F4] dark:text-[#E8DDFF] font-mono">{formatBytes(att.fileSize)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              disabled={ticketClosed || isReadOnlyLeader}
              onChange={handlePhotoSelect}
              className="hidden"
            />
            <button
              type="button"
              disabled={ticketClosed || isReadOnlyLeader || isCompressingPhoto}
              onClick={() => fileInputRef.current?.click()}
              className="btn-3d-lilac w-full min-h-[48px] rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isCompressingPhoto ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
              <span>{isCompressingPhoto ? 'Memproses Foto...' : '+ Ambil Foto / Lampiran Lapangan'}</span>
            </button>
          </div>

          {/* Field 4: Interactive Digital Signature Pad */}
          <div className="mj-tactile-well flex flex-col gap-2 p-3 rounded-xl">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[#26364A] dark:text-white flex items-center gap-1.5">
                <PenTool className="w-4 h-4 text-[#C88735] dark:text-amber-300" />
                <span>Tanda Tangan Digital Pelanggan / PIC</span>
              </label>
              {!ticketClosed && !isReadOnlyLeader && (
                <button
                  type="button"
                  onClick={handleResetSignature}
                  className="text-[11px] font-bold text-[#9B2C37] dark:text-rose-300 hover:underline flex items-center gap-1 min-h-[36px] px-2 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
              )}
            </div>

            <div className="relative w-full h-28 bg-white dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] rounded-xl overflow-hidden shadow-inner">
              <canvas
                ref={signatureCanvasRef}
                width={420}
                height={112}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                className={`w-full h-full touch-none ${
                  ticketClosed || isReadOnlyLeader ? 'cursor-not-allowed' : 'cursor-crosshair'
                }`}
              />
              {!signatureDataUrl && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-[#8492A5] dark:text-[#C5B3DF]">
                  Sentuh area ini untuk tanda tangan PIC / Pelanggan...
                </div>
              )}
              {signatureDataUrl && !hasNewSignatureStroke && (
                <img
                  src={getSafePreviewUrl(signatureDataUrl)}
                  alt="Tanda tangan tersimpan"
                  className="pointer-events-none absolute inset-0 w-full h-full object-contain opacity-85"
                />
              )}
              <span className="pointer-events-none absolute bottom-1.5 right-3 text-[10px] font-mono text-[#8492A5] dark:text-[#C5B3DF]">
                {signatureDataUrl ? 'Tersedia' : 'Opsional'}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="quick-pic-name" className="text-[10.5px] font-semibold text-[#52647A] dark:text-[#CEC0E8]">
                Nama Pelanggan / PIC Penandatangan
              </label>
              <div className="relative flex items-center">
                <UserCheck className="w-4 h-4 text-[#8492A5] dark:text-[#C5B3DF] absolute left-3 pointer-events-none" />
                <input
                  id="quick-pic-name"
                  type="text"
                  disabled={ticketClosed || isReadOnlyLeader}
                  value={signerName}
                  onChange={e => setSignerName(e.target.value)}
                  placeholder="Nama pelanggan atau PIC di lokasi..."
                  className="tactile-debossed-input w-full min-h-[44px] pl-9 pr-3 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
                />
              </div>
            </div>
          </div>

          {/* Field 5: LiveChat Sync Toggle (Auto Check-in #PROGRESS) */}
          {canSendChat && !ticketClosed && (
            <label className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-[#EAE8FF]/55 dark:hover:bg-[#241145] cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={syncToLiveChat}
                onChange={e => setSyncToLiveChat(e.target.checked)}
                className="mt-0.5 w-5 h-5 rounded accent-[#6657C8] dark:accent-[#58149C] cursor-pointer"
              />
              <div className="flex flex-col">
                <span className="text-xs font-bold text-[#26364A] dark:text-white flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
                  <span>Kirim log otomatis ke LiveChat Dispatch</span>
                </span>
                <span className="text-[11px] text-[#52647A] dark:text-[#C5B3DF]">
                  {selectedStatus === 'Pending Technical'
                    ? 'Terkirim dengan kategori #ISSUE untuk eskalasi cepat ke Dispatch.'
                    : 'Terkirim dengan kategori #PROGRESS (otomatis mencatat Check-in lapangan).'}
                </span>
              </div>
            </label>
          )}
        </form>

        {/* Sticky Ergonomic Footer */}
        <div className="sticky bottom-0 z-30 bg-[#F8FAFD]/95 dark:bg-[#160D29]/95 backdrop-blur-md border-t border-[#DDE6F0] dark:border-[#35105E] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col gap-2 shrink-0">
          {!ticketClosed && !isReadOnlyLeader && (
            <button
              type="submit"
              form="wo-quick-update-form"
              disabled={isSubmitting}
              className="btn-3d-primary w-full min-h-[48px] h-12 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Menyimpan Status...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Simpan &amp; Perbarui Status</span>
                </>
              )}
            </button>
          )}
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="btn-3d-ceramic w-full min-h-[44px] h-11 rounded-xl text-xs font-bold flex items-center justify-center cursor-pointer"
          >
            Batal / Kembali ke Work Order
          </button>
        </div>
      </section>
    </div>
  );
};
