import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Ticket, ChatAttachment } from '../../types/index.ts';
import { useApp } from '../../context/AppContext';
import { getSafePreviewUrl, formatFileSize } from '../../services/storageCompatibility';
import { formatJakartaTimeOnly } from '../../services/workSessionService';
import {
  Send,
  Image as ImageIcon,
  Paperclip,
  X,
  Shield,
  ShieldCheck,
  BadgeCheck,
  Maximize2,
  AlertCircle,
  AlertTriangle,
  MapPin,
  Tag,
  Check,
  CheckCircle2,
  Phone,
  Info,
  MessageSquare,
  Crosshair,
  Gauge,
  ArrowLeft,
  Router,
  Loader2
} from 'lucide-react';
import { MessageStatusReceipt } from './MessageStatusReceipt';
import { ResponsiveModal } from '../common/ResponsiveModal';

interface TicketLiveChatProps {
  ticket: Ticket;
  initialCategory?: string;
  heightClass?: string;
  onCollapse?: () => void;
  onBack?: () => void;
  onOpenTicketDetail?: (ticket: Ticket) => void;
  onOpenWhatsApp?: (ticket: Ticket) => void;
}

const getInitials = (name?: string): string => {
  if (!name) return 'MJ';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('');
};

/**
 * Highlights optical telemetry (e.g. -28.4 dBm), SN codes, and #TAGS inside chat text
 * without altering the stored message string.
 */
const renderHighlightedText = (text: string, isMe: boolean): React.ReactNode => {
  const tokenRegex = /(-?\d+(?:[.,]\d+)?\s*dBm|#[A-Za-z0-9_-]+|SN:\s*[A-Za-z0-9_-]+)/gi;
  const parts = text.split(tokenRegex);
  if (parts.length <= 1) return text;

  return parts.map((part, idx) => {
    if (!part) return null;
    if (/^-?\d+(?:[.,]\d+)?\s*dBm$/i.test(part)) {
      const numeric = parseFloat(part.replace(',', '.'));
      const isCritical = !Number.isNaN(numeric) && numeric < -27;
      return (
        <span
          key={idx}
          className={`inline-block px-1.5 py-0.5 rounded font-mono text-[11.5px] font-bold mx-0.5 ${
            isMe
              ? 'bg-white/20 text-white'
              : isCritical
              ? 'bg-[#ffdad6] text-[#93000a] dark:bg-rose-950/80 dark:text-rose-200'
              : 'bg-[#e7eeff] text-[#006194] dark:bg-[#261942] dark:text-sky-300'
          }`}
        >
          {part}
        </span>
      );
    }
    if (/^#[A-Za-z0-9_-]+$/i.test(part) || /^SN:\s*[A-Za-z0-9_-]+$/i.test(part)) {
      return (
        <span
          key={idx}
          className={`inline-block px-1.5 py-0.5 rounded font-mono text-[11.5px] font-bold mx-0.5 ${
            isMe
              ? 'bg-white/20 text-white'
              : 'bg-[#f0f3ff] text-[#006194] dark:bg-[#261942] dark:text-sky-300'
          }`}
        >
          {part}
        </span>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
};

export const TicketLiveChat: React.FC<TicketLiveChatProps> = ({
  ticket,
  initialCategory,
  heightClass = 'h-[560px]',
  onCollapse,
  onBack,
  onOpenTicketDetail,
  onOpenWhatsApp
}) => {
  const {
    currentUser,
    getMessagesForTicket,
    sendTicketMessage,
    markTicketMessagesAsRead,
    toast,
    chatCategories,
    setTicketChatCategory,
    databaseStatus
  } = useApp();

  const [inputText, setInputText] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showContextSummary, setShowContextSummary] = useState(true);

  const currentCategoryObj = (chatCategories || []).find(
    c => c.name === ticket.chatCategory || c.id === ticket.chatCategory
  );

  const activeCategories = useMemo(() => {
    const seen = new Set<string>();
    return (chatCategories || []).filter(c => {
      if (c.active === false || (c as any).isActive === false) return false;
      const upper = String(c.name || '').trim().toUpperCase();
      if (!upper || upper === 'UNCLASSIFIED' || seen.has(upper)) return false;
      seen.add(upper);
      return true;
    });
  }, [chatCategories]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = getMessagesForTicket(ticket.id);

  // Auto mark messages as read ONLY when chat pane is visible
  useEffect(() => {
    const tryMark = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      markTicketMessagesAsRead(ticket.id);
    };
    tryMark();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') tryMark();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [ticket.id, messages.length, markTicketMessagesAsRead]);

  // Auto scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
      if (!validTypes.includes(file.type)) {
        const msg = 'Format foto harus JPG, JPEG, PNG, atau WebP.';
        setErrorMessage(msg);
        toast.error(msg, 'Format Tidak Didukung');
        setTimeout(() => setErrorMessage(null), 4000);
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        const msg = `Ukuran file "${file.name}" melebihi batas maksimal 5MB.`;
        setErrorMessage(msg);
        toast.error(msg, 'File Terlalu Besar');
        setTimeout(() => setErrorMessage(null), 4000);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const attachment: ChatAttachment = {
          id: 'att-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
          url: dataUrl,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type
        };
        setPendingAttachments(prev => [...prev, attachment]);
        toast.info(`Foto ${file.name} siap dikirim.`, 'Lampiran Ditambahkan');
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemovePendingAttachment = (id: string) => {
    setPendingAttachments(prev => prev.filter(att => att.id !== id));
  };

  const [selectedCategory, setSelectedCategory] = useState<string>(() => {
    if (initialCategory && initialCategory.trim()) return initialCategory;
    return ticket.chatCategory && ticket.chatCategory.toUpperCase() !== 'UNCLASSIFIED' ? ticket.chatCategory : '';
  });

  useEffect(() => {
    if (initialCategory && initialCategory.trim()) {
      setSelectedCategory(initialCategory);
      return;
    }
    if (ticket.chatCategory && ticket.chatCategory.toUpperCase() !== 'UNCLASSIFIED') {
      setSelectedCategory(ticket.chatCategory);
    }
  }, [ticket.chatCategory, initialCategory]);

  const isInstaller = currentUser.role === 'installer';
  const isLeader = currentUser.role === 'leader';
  const hasValidCategory = Boolean(selectedCategory && selectedCategory.trim() && selectedCategory.toUpperCase() !== 'UNCLASSIFIED');

  const handleSelectCategory = (catName: string) => {
    if (isLeader) return;
    setSelectedCategory(catName);
    setErrorMessage(null);
    if (catName) {
      setTicketChatCategory(ticket.id, catName);
    }
  };

  const handleShareGps = () => {
    if (isLeader || isLocating) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast.error('Perangkat atau browser ini tidak mendukung Geolocation GPS.');
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setIsLocating(false);
        const lat = pos.coords.latitude.toFixed(6);
        const lng = pos.coords.longitude.toFixed(6);
        const gpsSnippet = `Lokasi teknisi terverifikasi GPS: ${lat}, ${lng} (https://maps.google.com/?q=${lat},${lng})`;
        setInputText(prev => (prev.trim() ? `${prev.trim()} | ${gpsSnippet}` : gpsSnippet));
        toast.success('Koordinat GPS disisipkan ke kolom pesan.');
        inputRef.current?.focus();
      },
      () => {
        setIsLocating(false);
        toast.info('Izin lokasi belum diaktifkan. Anda dapat mengetik lokasi manual pada pesan.');
      },
      { enableHighAccuracy: true, timeout: 7000 }
    );
  };

  const handleInsertTelemetry = () => {
    if (isLeader) return;
    const parts: string[] = [];
    if (ticket.fatCode) parts.push(`FAT: ${ticket.fatCode}${ticket.fatPort ? ` (${ticket.fatPort})` : ''}`);
    if (ticket.rosetRedamanDbm !== undefined && ticket.rosetRedamanDbm !== null) {
      parts.push(`OPM Roset: ${ticket.rosetRedamanDbm} dBm`);
    }
    if (ticket.ontSerialNumber) parts.push(`SN: ${ticket.ontSerialNumber}`);
    const text =
      parts.length > 0
        ? `Update telemetri perangkat ${ticket.woNumber} — ${parts.join(' | ')}.`
        : `Update hasil pengukuran OPM ${ticket.fatCode || 'FAT'} untuk ${ticket.woNumber}: ... dBm`;
    setInputText(prev => (prev.trim() ? `${prev.trim()} ${text}` : text));
    inputRef.current?.focus();
  };

  const handleTriggerIssue = () => {
    if (isLeader) return;
    const issueCat = activeCategories.find(c => String(c.name).toUpperCase() === 'ISSUE')?.name || 'ISSUE';
    handleSelectCategory(issueCat);
    setInputText(prev =>
      prev.trim() ? prev : `Kendala lapangan pada ${ticket.woNumber} (${ticket.fatCode || ticket.area || 'lokasi'}): `
    );
    inputRef.current?.focus();
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend !== undefined ? textToSend : inputText;
    if (isSubmitting || isLeader) return;

    if (isInstaller && !hasValidCategory) {
      const msg = 'Pilih kategori chat terlebih dahulu (mis. PROGRESS) sebelum memulai percakapan.';
      setErrorMessage(msg);
      toast.error(msg, 'Kategori Wajib Dipilih');
      return;
    }

    if (!text.trim() && pendingAttachments.length === 0) return;

    setIsSubmitting(true);
    try {
      const result = await sendTicketMessage(
        ticket.id,
        text.trim(),
        pendingAttachments,
        isInstaller ? selectedCategory : selectedCategory || undefined
      );

      if (result.success) {
        setInputText('');
        setPendingAttachments([]);
        setErrorMessage(null);
      } else {
        const err = result.error || 'Gagal mengirim pesan.';
        setErrorMessage(err);
        toast.error(err, 'Gagal Mengirim');
        setTimeout(() => setErrorMessage(null), 4000);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'dispatch':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#dbe1ff] text-[#004b73] dark:bg-sky-950/80 dark:text-sky-200 text-[9.5px] font-bold uppercase tracking-wide">
            DISPATCH
          </span>
        );
      case 'installer':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200 text-[9.5px] font-bold uppercase tracking-wide">
            TEKNISI
          </span>
        );
      case 'leader':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-200 text-[9.5px] font-bold uppercase tracking-wide">
            KORLAP
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#f0dbff] text-[#58149c] dark:bg-purple-950/80 dark:text-purple-200 text-[9.5px] font-bold uppercase tracking-wide">
            SUPER ADMIN
          </span>
        );
    }
  };

  const hasCheckIn =
    Boolean(ticket.checkInAt) ||
    messages.some(m => m.isCheckIn || String(m.category || '').toUpperCase() === 'PROGRESS');

  const contactPhone = ticket.installerContact || ticket.customerPhone;
  const isCriticalPriority =
    String(ticket.ticketCategory || '').toUpperCase().includes('SAMEDAY') ||
    String(ticket.ticketCategory || '').toUpperCase().includes('EXPRESS') ||
    ticket.approvalStatus === 'BUTUH APPROVAL' ||
    ticket.approvalStatus === 'REVISI';

  const hasRealTelemetry = Boolean(
    ticket.rosetRedamanDbm !== undefined ||
      ticket.fatRedamanDbm !== undefined ||
      ticket.ontSerialNumber ||
      ticket.dropcoreLengthMeter ||
      ticket.dropcoreLength
  );

  return (
    <div className={`flex flex-col ${heightClass} bg-[#f9f9ff] dark:bg-[#140827] overflow-hidden`}>
      {/* STITCH SCREEN 4: TOP WAR ROOM CONTEXT HEADER */}
      <div className="bg-white dark:bg-[#1A0E2E] px-3.5 py-2.5 border-b border-[#d8e3fb] dark:border-[#35105E] shrink-0 space-y-2 shadow-2xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="w-9 h-9 rounded-full hover:bg-[#f0f3ff] dark:hover:bg-[#261942] flex items-center justify-center text-[#111c2d] dark:text-white transition-colors shrink-0 cursor-pointer"
                aria-label="Kembali"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}

            <div className="relative shrink-0">
              <div className="w-10 h-10 rounded-full bg-[#e7eeff] dark:bg-[#261942] text-[#006194] dark:text-sky-300 font-display font-bold text-xs flex items-center justify-center border border-[#d8e3fb] dark:border-[#4B386B]">
                {getInitials(ticket.installerName || ticket.customerName)}
              </div>
              <span
                className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-[#1A0E2E] ${
                  databaseStatus === 'connected' ? 'bg-[#16A36A]' : 'bg-amber-500'
                }`}
              />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-display font-bold text-[14px] text-[#111c2d] dark:text-white leading-tight truncate">
                  Dispatch War Room Chat
                </span>
                <BadgeCheck className="w-4 h-4 text-[#006194] dark:text-sky-400 shrink-0" />
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#3f4850] dark:text-[#CEC0E8] truncate mt-0.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    databaseStatus === 'connected' ? 'bg-[#006194]' : 'bg-amber-500'
                  }`}
                />
                <span className="truncate">
                  {databaseStatus === 'connected' ? 'Radio & Dispatch Active' : 'Sinkronisasi Lokal'} ·{' '}
                  <span className="font-mono font-bold text-[#006194] dark:text-sky-300">{ticket.woNumber}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {contactPhone && (
              <a
                href={`tel:${contactPhone.replace(/[^\d+]/g, '')}`}
                className="w-9 h-9 rounded-full hover:bg-[#f0f3ff] dark:hover:bg-[#261942] flex items-center justify-center text-[#111c2d] dark:text-[#E9D5FF] transition-colors"
                title={`Hubungi ${contactPhone}`}
                aria-label="Hubungi Kontak WO"
              >
                <Phone className="w-4 h-4" />
              </a>
            )}
            <button
              type="button"
              onClick={() => (onOpenTicketDetail ? onOpenTicketDetail(ticket) : setShowContextSummary(prev => !prev))}
              className="w-9 h-9 rounded-full hover:bg-[#f0f3ff] dark:hover:bg-[#261942] flex items-center justify-center text-[#111c2d] dark:text-[#E9D5FF] transition-colors cursor-pointer"
              title="Info & Telemetri Work Order"
              aria-label="Info Work Order"
            >
              <Info className="w-4 h-4" />
            </button>
            {onCollapse && (
              <button
                type="button"
                onClick={onCollapse}
                className="w-9 h-9 rounded-full hover:bg-[#f0f3ff] dark:hover:bg-[#261942] flex items-center justify-center text-[#707881] dark:text-[#CEC0E8] transition-colors cursor-pointer"
                title="Lipat Panel LiveChat"
                aria-label="Tutup Panel LiveChat"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* FLOATING OPERATIONAL CONTEXT STRIP (Real WO Scope & Status) */}
        {showContextSummary && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#f0f3ff] dark:bg-[#160D29] border border-[#d8e3fb]/80 dark:border-[#35105E] text-[11px]">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <ShieldCheck className={`w-3.5 h-3.5 shrink-0 ${hasCheckIn ? 'text-[#16A36A]' : 'text-[#006194]'}`} />
              <span className="font-semibold text-[#111c2d] dark:text-white truncate">
                {ticket.customerName}
              </span>
              {ticket.fatCode && (
                <span className="font-mono text-[10px] font-bold text-[#006194] dark:text-sky-300 bg-white dark:bg-[#22123F] px-1.5 py-0.5 rounded shrink-0">
                  {ticket.fatCode}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {onOpenWhatsApp && (
                <button
                  type="button"
                  onClick={() => onOpenWhatsApp(ticket)}
                  className="px-2 py-0.5 rounded-md bg-white dark:bg-[#22123F] border border-[#d8e3fb] dark:border-[#4B386B] text-[#006194] dark:text-sky-300 font-bold text-[10px] flex items-center gap-1 hover:bg-[#e7eeff] cursor-pointer"
                >
                  <MessageSquare className="w-3 h-3" />
                  <span>WA</span>
                </button>
              )}
              <span
                className={`px-2 py-0.5 rounded-md font-bold text-[10px] uppercase tracking-wide ${
                  hasCheckIn
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                    : isCriticalPriority
                    ? 'bg-[#ba1a1a] text-white'
                    : 'bg-[#dbe1ff] text-[#004b73] dark:bg-[#35105E] dark:text-[#E9D5FF]'
                }`}
              >
                {hasCheckIn ? 'Check-in Valid' : ticket.statusWOInstaller || 'Menunggu Check-in'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* MESSAGES TIMELINE STREAM */}
      <div className="flex-1 px-3.5 py-4 overflow-y-auto space-y-3.5 bg-[#f9f9ff] dark:bg-[#140827]">
        {/* Real System Checkpoint Pill (derived strictly from real WO timestamps) */}
        {(ticket.checkInAt || ticket.workStartedAt || ticket.assignedAt) && (
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-[#e7eeff] dark:bg-[#22123F] text-[#3f4850] dark:text-[#D8B4FE] text-[11px] font-semibold shadow-2xs max-w-full">
              <MapPin className="w-3.5 h-3.5 text-[#006194] dark:text-sky-400 shrink-0" />
              <span className="truncate">
                {ticket.checkInAt
                  ? `${ticket.installerName || 'Teknisi'} Check-in #PROGRESS (${formatJakartaTimeOnly(ticket.checkInAt)} WIB)`
                  : ticket.workStartedAt
                  ? `Mulai pengerjaan (${formatJakartaTimeOnly(ticket.workStartedAt)} WIB) · ${ticket.area || ticket.clusterName || '-'}`
                  : `Assigned ke ${ticket.installerName || 'Teknisi'} · ${ticket.slotTime || ticket.area || '-'}`}
              </span>
            </div>
          </div>
        )}

        {messages.length === 0 ? (
          <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-center p-6 text-[#707881] space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-[#e7eeff] dark:bg-[#261942] text-[#006194] dark:text-sky-300 flex items-center justify-center shadow-xs">
              <MessageSquare className="w-6 h-6" />
            </div>
            <h4 className="font-display font-bold text-[#111c2d] dark:text-white text-sm">
              Belum Ada Percakapan pada Work Order Ini
            </h4>
            <p className="text-xs max-w-sm text-[#3f4850] dark:text-[#CEC0E8] leading-relaxed">
              {isInstaller
                ? 'Pilih kategori PROGRESS dan kirim pesan pertama untuk mencatat Check-in lapangan otomatis sebelum mengisi laporan checkout.'
                : `Mulai koordinasi lapangan bersama ${ticket.installerName || 'Teknisi Lapangan'} untuk redaman OPM, perangkat ONT, atau kendala lokasi.`}
            </p>
          </div>
        ) : (
          messages.map(msg => {
            const isMe = msg.senderId === currentUser.id || msg.senderRole === currentUser.role;
            const timeLabel = new Date(msg.timestamp).toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Jakarta'
            });

            return (
              <div
                key={msg.id}
                className={`flex items-start gap-2.5 ${isMe ? 'justify-end' : 'justify-start'}`}
              >
                {!isMe && (
                  <div className="relative shrink-0 mt-1">
                    <div className="w-8 h-8 rounded-full bg-[#dee8ff] dark:bg-[#261942] text-[#006194] dark:text-sky-300 font-display font-bold text-[11px] flex items-center justify-center">
                      {getInitials(msg.senderName)}
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#16A36A] border-2 border-[#f9f9ff] dark:border-[#140827]" />
                  </div>
                )}

                <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[85%] space-y-1`}>
                  {/* Sender Header */}
                  <div className="flex items-center gap-1.5 text-[11px] flex-wrap px-0.5">
                    {isMe ? (
                      <>
                        <span className="font-mono text-[10.5px] text-[#707881] dark:text-[#A78BFA] tabular-nums">
                          {timeLabel}
                        </span>
                        <span className="font-bold text-[#006194] dark:text-sky-300">
                          Anda ({msg.senderName?.split(' ')[0] || 'User'})
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-bold text-[#111c2d] dark:text-white">{msg.senderName}</span>
                        {getRoleBadge(msg.senderRole)}
                        <span className="font-mono text-[10.5px] text-[#707881] dark:text-[#A78BFA] tabular-nums">
                          {timeLabel}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Bubble Card */}
                  <div
                    className={`rounded-2xl px-3.5 py-2.5 space-y-2 ${
                      isMe
                        ? 'bg-[#006194] text-white rounded-tr-sm shadow-md'
                        : 'bg-white dark:bg-[#1E1238] text-[#111c2d] dark:text-slate-100 rounded-tl-sm shadow-xs border border-[#d8e3fb]/80 dark:border-[#35105E]'
                    }`}
                  >
                    {msg.category && String(msg.category).toUpperCase() !== 'UNCLASSIFIED' && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-mono text-[9.5px] font-bold uppercase tracking-wide ${
                            isMe
                              ? 'bg-white/20 text-white'
                              : msg.isCheckIn || String(msg.category).toUpperCase() === 'PROGRESS'
                              ? 'bg-[#e7eeff] text-[#006194] dark:bg-[#261942] dark:text-sky-300'
                              : 'bg-[#f0f3ff] text-[#3f4850] dark:bg-[#35105E] dark:text-[#D8B4FE]'
                          }`}
                        >
                          <Tag className="w-2.5 h-2.5" />
                          <span>
                            #{msg.category}
                            {msg.isCheckIn ? ' · CHECK-IN' : ''}
                          </span>
                        </span>
                      </div>
                    )}

                    {msg.text && (
                      <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                        {renderHighlightedText(msg.text, isMe)}
                      </p>
                    )}

                    {/* Real Media Attachments */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        {msg.attachments.map(att => {
                          const previewUrl = getSafePreviewUrl(att.url);
                          return (
                            <div
                              key={att.id}
                              onClick={() => setZoomImage(previewUrl || att.url)}
                              className="group relative cursor-pointer rounded-xl overflow-hidden border border-black/10 dark:border-white/15 bg-black/5"
                            >
                              <img
                                src={previewUrl}
                                alt={att.fileName}
                                referrerPolicy="no-referrer"
                                className="w-full h-32 object-cover transition-transform duration-200 group-hover:scale-105"
                              />
                              <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white gap-1.5 text-xs font-semibold">
                                <Maximize2 className="w-4 h-4" />
                                <span>Perbesar</span>
                              </div>
                              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2 flex items-center justify-between gap-2 text-[10px] text-white">
                                <span className="font-medium truncate">{att.fileName}</span>
                                <span className="px-1.5 py-0.5 rounded-full bg-[#16A36A] text-white font-bold text-[9px] shrink-0">
                                  {att.fileSize > 0 ? formatFileSize(att.fileSize) : 'Bukti'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {isMe && (
                      <div className="flex justify-end pt-0.5">
                        <MessageStatusReceipt
                          message={msg}
                          senderId={currentUser.id}
                          variant="onDark"
                          showLabel={true}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Real Optical & Device Telemetry Terminal Block (only rendered when WO has real metrics) */}
        {hasRealTelemetry && (
          <div className="rounded-xl bg-[#263143] text-[#ecf1ff] p-3 font-mono text-[11px] space-y-1.5 shadow-sm border border-[#3f4850]/50">
            <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-[#93ccff]">
              <span className="flex items-center gap-1.5 font-bold">
                <Router className="w-3.5 h-3.5" />
                <span>Telemetry Perangkat WO</span>
              </span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                {ticket.checkInAt ? 'TERVERIFIKASI' : 'LIVE WO'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              {ticket.fatCode && (
                <div>
                  <span className="text-slate-400">FAT:</span> {ticket.fatCode}
                  {ticket.fatPort ? ` (${ticket.fatPort})` : ''}
                </div>
              )}
              {ticket.ontSerialNumber && (
                <div className="truncate">
                  <span className="text-slate-400">SN:</span> {ticket.ontSerialNumber}
                </div>
              )}
              {ticket.rosetRedamanDbm !== undefined && ticket.rosetRedamanDbm !== null && (
                <div className={Number(ticket.rosetRedamanDbm) < -27 ? 'text-rose-300 font-bold' : 'text-emerald-300 font-bold'}>
                  <span className="text-slate-400 font-normal">Rx Roset:</span> {ticket.rosetRedamanDbm} dBm
                </div>
              )}
              {(ticket.dropcoreLengthMeter || ticket.dropcoreLength) && (
                <div>
                  <span className="text-slate-400">Dropcore:</span> {ticket.dropcoreLengthMeter || ticket.dropcoreLength}m
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="mx-3.5 my-2 p-2.5 rounded-xl bg-[#ffdad6] dark:bg-rose-950/60 border border-[#ba1a1a]/30 text-[#93000a] dark:text-rose-200 text-xs flex items-center gap-2 shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* STRICT RBAC: Leader is monitoring-only in LiveChat */}
      {isLeader ? (
        <div className="p-3.5 bg-amber-50 dark:bg-amber-950/50 border-t border-amber-200 dark:border-amber-800 text-center text-xs text-amber-800 dark:text-amber-300 font-medium flex items-center justify-center gap-2 shrink-0 pb-safe">
          <Shield className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Mode Pantau: Leader hanya dapat membaca riwayat LiveChat (monitoring-only).</span>
        </div>
      ) : (
        <div className="bg-white/90 dark:bg-[#1A0E2E] border-t border-[#d8e3fb] dark:border-[#35105E] shrink-0">
          {/* Mandatory Category Pills + Quick Action Chips (Stitch Screen 4 Style) */}
          <div className="px-3 pt-2.5 pb-1.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {activeCategories.map(cat => {
              const isActive = selectedCategory.toUpperCase() === String(cat.name).toUpperCase();
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    handleSelectCategory(cat.name);
                    toast.success(`Kategori #${cat.name} aktif.`);
                  }}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors shrink-0 ${
                    isActive
                      ? 'bg-[#006194] text-white shadow-xs'
                      : 'bg-[#f0f3ff] dark:bg-[#261942] text-[#004b73] dark:text-[#E9D5FF] hover:bg-[#e7eeff]'
                  }`}
                >
                  {isActive && <Check className="w-3 h-3" />}
                  <span>#{cat.name}</span>
                </button>
              );
            })}

            <span className="h-4 w-px bg-[#d8e3fb] dark:bg-[#35105E] shrink-0 mx-0.5" />

            <button
              type="button"
              onClick={handleShareGps}
              disabled={isLocating}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#f0f3ff] dark:bg-[#261942] hover:bg-[#e7eeff] text-[#006194] dark:text-sky-300 text-[11px] font-semibold whitespace-nowrap cursor-pointer shrink-0"
            >
              {isLocating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Crosshair className="w-3 h-3" />}
              <span>Share GPS</span>
            </button>

            <button
              type="button"
              onClick={handleInsertTelemetry}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#ffddb8]/70 dark:bg-amber-950/60 hover:bg-[#ffddb8] text-[#653e00] dark:text-amber-300 text-[11px] font-semibold whitespace-nowrap cursor-pointer shrink-0"
            >
              <Gauge className="w-3 h-3" />
              <span>Telemetri OPM</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#f0f3ff] dark:bg-[#261942] hover:bg-[#e7eeff] text-[#006194] dark:text-sky-300 text-[11px] font-semibold whitespace-nowrap cursor-pointer shrink-0"
            >
              <ImageIcon className="w-3 h-3" />
              <span>Foto Bukti</span>
            </button>

            <button
              type="button"
              onClick={handleTriggerIssue}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#ffdad6] dark:bg-rose-950/70 hover:brightness-95 text-[#93000a] dark:text-rose-200 text-[11px] font-semibold whitespace-nowrap cursor-pointer shrink-0"
            >
              <AlertTriangle className="w-3 h-3" />
              <span>Kendala</span>
            </button>
          </div>

          {/* Pending Photo Upload Previews */}
          {pendingAttachments.length > 0 && (
            <div className="px-3 py-2 bg-[#f0f3ff] dark:bg-[#261942] border-t border-[#d8e3fb] dark:border-[#4B386B] flex items-center gap-2.5 overflow-x-auto">
              {pendingAttachments.map(att => (
                <div key={att.id} className="relative group shrink-0 w-14 h-14 rounded-xl overflow-hidden border-2 border-[#006194] shadow-sm">
                  <img src={att.url} alt={att.fileName} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => handleRemovePendingAttachment(att.id)}
                    className="absolute top-0.5 right-0.5 p-0.5 bg-[#ba1a1a] text-white rounded-full cursor-pointer"
                    title="Hapus foto"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <span className="text-xs font-semibold text-[#004b73] dark:text-[#E9D5FF]">
                {pendingAttachments.length} foto siap dikirim
              </span>
            </div>
          )}

          {/* Mandatory Category Warning for Installer */}
          {isInstaller && !hasValidCategory && (
            <div className="mx-3 mb-1.5 px-3 py-1.5 rounded-xl bg-[#ffddb8]/60 dark:bg-amber-950/70 border border-[#825100]/20 flex items-center gap-2 text-[11px] text-[#653e00] dark:text-amber-200 font-semibold">
              <AlertCircle className="w-3.5 h-3.5 text-[#825100] shrink-0" />
              <span>Pilih kategori (#PROGRESS untuk Check-in lokasi) sebelum mengirim pesan.</span>
            </div>
          )}

          {/* Ergonomic Sticky Bottom Input Deck */}
          <form
            onSubmit={e => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="px-3 pb-safe pt-1"
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept="image/jpeg,image/png,image/webp,image/jpg"
              multiple
              className="hidden"
            />
            <div className="flex items-center gap-1.5 bg-[#f0f3ff] dark:bg-[#160D29] rounded-2xl p-1.5 border border-[#d8e3fb] dark:border-[#4B386B] shadow-inner">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-10 h-10 rounded-xl bg-white dark:bg-[#261942] text-[#006194] dark:text-[#DAB9FF] hover:bg-[#e7eeff] flex items-center justify-center shrink-0 cursor-pointer shadow-2xs transition-colors"
                title="Lampirkan Foto Lapangan"
                aria-label="Lampirkan Foto"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder={
                  isInstaller && !hasValidCategory
                    ? 'Pilih tag #PROGRESS atau kategori di atas...'
                    : 'Ketik pesan koordinasi operasional...'
                }
                className="flex-1 min-w-0 bg-transparent px-2 py-1.5 text-xs sm:text-[13px] text-[#111c2d] dark:text-white placeholder:text-[#707881] focus:outline-none"
              />

              <button
                type="submit"
                disabled={isSubmitting || (isInstaller && !hasValidCategory) || (!inputText.trim() && pendingAttachments.length === 0)}
                className="w-10 h-10 rounded-xl bg-[#006194] hover:bg-[#004b73] text-white flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm transition-colors"
                title="Kirim Pesan"
                aria-label="Kirim Pesan"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Fullscreen Lightbox / Zoom Modal */}
      <ResponsiveModal
        isOpen={Boolean(zoomImage)}
        onClose={() => setZoomImage(null)}
        size="xl"
        mobileVariant="fullscreen"
        zIndexClass="z-70"
        icon={<ImageIcon className="w-4 h-4" />}
        title="Preview Lampiran Foto LiveChat"
      >
        {zoomImage && (
          <div className="flex items-center justify-center min-h-[260px] bg-slate-950/90 rounded-xl p-2 sm:p-4">
            <img
              src={getSafePreviewUrl(zoomImage)}
              alt="Bukti Lapangan Zoom"
              referrerPolicy="no-referrer"
              className="max-w-full max-h-[75dvh] object-contain rounded-xl shadow-2xl"
            />
          </div>
        )}
      </ResponsiveModal>
    </div>
  );
};
