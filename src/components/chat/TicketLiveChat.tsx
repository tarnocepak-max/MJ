import React, { useState, useRef, useEffect } from 'react';
import { Ticket, ChatAttachment } from '../../types/index.ts';
import { useApp } from '../../context/AppContext';
import { getSafePreviewUrl } from '../../services/storageCompatibility';
import {
  Send,
  Image as ImageIcon,
  X,
  Shield,
  Wrench,
  Maximize2,
  AlertCircle,
  Building2,
  Tag,
  Check
} from 'lucide-react';
import { MessageStatusReceipt } from './MessageStatusReceipt';

interface TicketLiveChatProps {
  ticket: Ticket;
  initialCategory?: string;
  heightClass?: string;
  onCollapse?: () => void;
}

export const TicketLiveChat: React.FC<TicketLiveChatProps> = ({
  ticket,
  initialCategory,
  heightClass = 'h-[560px]',
  onCollapse
}) => {
  const {
    currentUser,
    getMessagesForTicket,
    sendTicketMessage,
    markTicketMessagesAsRead,
    toast,
    chatCategories,
    setTicketChatCategory
  } = useApp();
  const [inputText, setInputText] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const currentCategoryObj = (chatCategories || []).find(
    c => c.name === ticket.chatCategory || c.id === ticket.chatCategory
  );
  const activeCategories = React.useMemo(() => {
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = getMessagesForTicket(ticket.id);

  // Auto mark messages as read ONLY when chat tab/pane is actively visible
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

  // Handle image upload from camera or local file
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
          id: 'att-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
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
  const hasValidCategory = Boolean(selectedCategory && selectedCategory.trim() && selectedCategory.toUpperCase() !== 'UNCLASSIFIED');

  const handleSelectCategory = (catName: string) => {
    setSelectedCategory(catName);
    setErrorMessage(null);
    if (catName) {
      setTicketChatCategory(ticket.id, catName);
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend !== undefined ? textToSend : inputText;
    if (isSubmitting) return;

    // Requirement 7: Installer wajib memilih kategori chat terlebih dahulu
    if (isInstaller && !hasValidCategory) {
      const msg = 'Pilih kategori chat terlebih dahulu sebelum memulai percakapan.';
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
        isInstaller ? selectedCategory : undefined
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

  const quickReplies = [
    'Teknisi sudah tiba di lokasi pelanggan.',
    'Pengecekan redaman FAT: -18 dBm (Bagus).',
    'Kendala redaman drop: LOS Red Light.',
    'Pemasangan ONT selesai, wifi aktif & stabil.',
    'Mohon verifikasi close ticket dari Dispatch.'
  ];

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'dispatch':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
            <Shield className="w-3 h-3 text-indigo-600" /> Dispatch Officer
          </span>
        );
      case 'installer':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <Wrench className="w-3 h-3 text-emerald-600" /> Teknisi Lapangan
          </span>
        );
      case 'leader':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <Building2 className="w-3 h-3 text-amber-600" /> Korlap Mitra
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
            Super Admin
          </span>
        );
    }
  };

  const hasCheckIn = Boolean(ticket.checkInAt) || messages.some(m => m.isCheckIn || String(m.category || '').toUpperCase() === 'PROGRESS');

  return (
    <div className={`flex flex-col ${heightClass} bg-white dark:bg-[#1E1238] overflow-hidden`}>
      {/* Stitch AI Dark Purple Chat Header Bar */}
      <div className="px-4 py-3 bg-[#160D29] text-white flex flex-wrap items-center justify-between gap-2.5 shrink-0 border-b border-[#35105E]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-[#35105E] text-[#A78BFA] flex items-center justify-center shadow-inner shrink-0 border border-[#7135B5]/40">
            <Shield className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-white text-[14px] leading-tight truncate">
                Ticket LiveChat
              </span>
              <span className="w-2 h-2 rounded-full bg-[#16A36A] shrink-0" title="Terhubung Real-Time" />
            </div>
            <div className="text-[11px] text-[#A78BFA] truncate mt-0.5">
              Thread · <span className="font-mono text-[#E9D5FF]">{ticket.woNumber}</span> · {ticket.installerName || 'Belum Assign'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className={`px-2.5 py-1 rounded-full font-bold text-[10px] uppercase tracking-wide flex items-center gap-1 border ${
              hasCheckIn
                ? 'bg-[#35105E]/90 text-white border-[#A78BFA]/30'
                : 'bg-[#35105E]/50 text-[#CEC0E8] border-[#4B386B]'
            }`}
          >
            {hasCheckIn && <Check className="w-3 h-3 text-[#16A36A]" />}
            <span>{hasCheckIn ? 'Check-in Valid' : 'Belum Check-in'}</span>
          </div>
          <span className="px-2 py-1 bg-[#261942] border border-[#4B386B] font-mono text-[10px] font-bold text-[#DAB9FF] rounded-lg tabular-nums">
            {messages.length}
          </span>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="p-1.5 rounded-lg text-[#CEC0E8] hover:text-white hover:bg-[#35105E] transition-colors cursor-pointer"
              title="Lipat Panel LiveChat"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* SOP Check-in & Category Summary Strip */}
      <div className="px-4 py-1.5 bg-[#F5F1FF] dark:bg-[#190F2E] flex flex-wrap items-center justify-between gap-2 border-b border-[#E9E5F0] dark:border-[#35105E] text-[10.5px] shrink-0">
        <span className="font-semibold text-[#494453] dark:text-[#CEC0E8]">
          {isInstaller ? 'SOP: Kirim kategori PROGRESS untuk Check-in lokasi' : `Pelanggan: ${ticket.customerName} (${ticket.idCustomer})`}
        </span>
        <div className="flex items-center gap-1.5">
          {(isInstaller ? selectedCategory : ticket.chatCategory) &&
            String(isInstaller ? selectedCategory : ticket.chatCategory).toUpperCase() !== 'UNCLASSIFIED' && (
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white flex items-center gap-1"
                style={{ backgroundColor: currentCategoryObj?.color || '#5B35B1' }}
              >
                <Tag className="w-2.5 h-2.5" />
                <span>{isInstaller ? selectedCategory : ticket.chatCategory}</span>
              </span>
            )}
          <span className={`font-mono font-bold ${hasCheckIn ? 'text-[#16A36A]' : 'text-[#D97706]'}`}>
            {hasCheckIn ? 'Check-in Tercatat' : 'Menunggu PROGRESS'}
          </span>
        </div>
      </div>

      {/* Messages Stream */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3.5 bg-[#F7F6FA] dark:bg-[#140827]">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[#8B8495] space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-[#F0E3FF] dark:bg-[#261942] text-[#7135B5] dark:text-[#DAB9FF] flex items-center justify-center shadow-xs">
              <Shield className="w-6 h-6" />
            </div>
            <h4 className="font-bold text-[#211A2E] dark:text-white text-sm">
              Belum Ada Percakapan pada Work Order Ini
            </h4>
            <p className="text-xs max-w-sm text-[#766B83] dark:text-[#CEC0E8] leading-relaxed">
              Mulai komunikasi antara <strong>Dispatch Officer</strong> dan <strong>Teknisi Lapangan</strong> ({ticket.installerName || 'Installer'}) untuk koordinasi penugasan, hasil redaman optik, atau kirim foto bukti pengerjaan.
            </p>
          </div>
        ) : (
          messages.map(msg => {
            const isMe = msg.senderId === currentUser.id || msg.senderRole === currentUser.role;
            const isInstallerMsg = msg.senderRole === 'installer';

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} space-y-1`}
              >
                {/* Sender badge & time */}
                <div className="flex items-center gap-1.5 text-[11px] flex-wrap">
                  {isMe ? (
                    <>
                      <span className="font-mono text-[10.5px] text-[#8B8495] tabular-nums">
                        {new Date(msg.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {getRoleBadge(msg.senderRole)}
                      <span className="font-bold text-[#211A2E] dark:text-white">{msg.senderName}</span>
                    </>
                  ) : (
                    <>
                      <span className="font-bold text-[#211A2E] dark:text-white">{msg.senderName}</span>
                      {getRoleBadge(msg.senderRole)}
                      <span className="font-mono text-[10.5px] text-[#8B8495] tabular-nums">
                        {new Date(msg.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </>
                  )}
                </div>

                {/* Bubble Container */}
                <div
                  className={`max-w-[90%] sm:max-w-[82%] rounded-2xl p-3 shadow-xs space-y-2 ${
                    isMe
                      ? 'bg-[#7135B5] text-white rounded-tr-sm border border-[#A78BFA]/30'
                      : isInstallerMsg
                      ? 'bg-white dark:bg-[#1E1238] text-[#211A2E] dark:text-slate-100 border border-[#86EFAC] dark:border-emerald-800/70 rounded-tl-sm'
                      : 'bg-white dark:bg-[#1E1238] text-[#211A2E] dark:text-slate-100 border border-[#E9E5F0] dark:border-[#35105E] rounded-tl-sm'
                  }`}
                >
                  {msg.category && String(msg.category).toUpperCase() !== 'UNCLASSIFIED' && (
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded font-bold text-[10px] uppercase tracking-wide ${
                        isMe
                          ? 'bg-white/20 text-white'
                          : msg.isCheckIn || String(msg.category).toUpperCase() === 'PROGRESS'
                          ? 'bg-[#3977C9]/15 text-[#3977C9] dark:text-blue-300'
                          : 'bg-[#F0E3FF] text-[#5B35B1] dark:bg-[#35105E] dark:text-[#DAB9FF]'
                      }`}
                    >
                      {msg.category}{msg.isCheckIn ? ' · CHECK-IN' : ''}
                    </span>
                  )}

                  {msg.text && (
                    <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap break-words font-normal">
                      {msg.text}
                    </p>
                  )}

                  {/* Photo Attachments */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {msg.attachments.map(att => (
                        <div
                          key={att.id}
                          onClick={() => setZoomImage(att.url)}
                          className="group relative cursor-pointer rounded-xl overflow-hidden border border-black/15 dark:border-white/15 bg-black/5"
                        >
                          <img
                            src={getSafePreviewUrl(att.url)}
                            alt={att.fileName}
                            referrerPolicy="no-referrer"
                            className="w-full h-28 object-cover transition-transform duration-200 group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white gap-1.5 text-xs font-semibold">
                            <Maximize2 className="w-4 h-4" />
                            <span>Perbesar</span>
                          </div>
                          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-1.5 text-[10px] text-white font-mono truncate">
                            {att.fileName}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {isMe && (
                  <MessageStatusReceipt
                    message={msg}
                    senderId={currentUser.id}
                    variant="onLight"
                    showLabel={true}
                    className="mt-0.5"
                  />
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="mx-3.5 my-2 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs flex items-center gap-2 shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Leader is strictly monitoring-only in chat */}
      {currentUser.role === 'leader' ? (
        <div className="p-3.5 bg-amber-50 dark:bg-amber-950/50 border-t border-amber-200 dark:border-amber-800 text-center text-xs text-amber-800 dark:text-amber-300 font-medium flex items-center justify-center gap-2 shrink-0">
          <Shield className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Mode Pantau: Leader hanya dapat membaca riwayat LiveChat (monitoring-only).</span>
        </div>
      ) : (
        <>
          {/* Installer Category Selector Bar OR Quick Reply Tactile Chips */}
          {isInstaller ? (
            <div className="px-3.5 py-2 bg-white dark:bg-[#1E1238] border-t border-[#E9E5F0] dark:border-[#35105E] flex items-center justify-between gap-2 flex-wrap shrink-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#8B8495]">
                Kategori Pesan{!hasValidCategory ? ' (Wajib)' : ''}:
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {activeCategories.map(cat => {
                  const isActive = selectedCategory.toUpperCase() === String(cat.name).toUpperCase();
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        handleSelectCategory(cat.name);
                        toast.success(`Kategori chat dipilih: "${cat.name}".`);
                      }}
                      className={`tactile-chip px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase cursor-pointer ${
                        isActive ? 'tactile-chip-active' : 'text-[#494453]'
                      }`}
                    >
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="px-3.5 py-2 bg-[#F8F1FF] dark:bg-[#190F2E] border-t border-[#E9E5F0] dark:border-[#35105E] flex items-center gap-1.5 overflow-x-auto text-xs shrink-0">
              <span className="text-[10px] font-bold uppercase text-[#8B8495] shrink-0">Template:</span>
              {quickReplies.map((reply, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSendMessage(reply)}
                  className="tactile-chip whitespace-nowrap px-2.5 py-0.5 rounded-full text-[#35105E] text-[10.5px] font-semibold cursor-pointer shrink-0"
                >
                  {reply}
                </button>
              ))}
            </div>
          )}

          {/* Pending Photo Upload Previews */}
          {pendingAttachments.length > 0 && (
            <div className="px-3.5 py-2 bg-[#F5F1FF] dark:bg-[#261942] border-t border-[#D8CCF3] dark:border-[#4B386B] flex items-center gap-2.5 overflow-x-auto shrink-0">
              {pendingAttachments.map(att => (
                <div key={att.id} className="relative group shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2 border-[#7135B5] shadow-sm">
                  <img src={att.url} alt={att.fileName} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => handleRemovePendingAttachment(att.id)}
                    className="absolute top-1 right-1 p-0.5 bg-rose-600 text-white rounded-full hover:bg-rose-700 transition-colors shadow-sm cursor-pointer"
                    title="Hapus foto"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <span className="text-xs font-semibold text-[#35105E] dark:text-[#E9D5FF]">
                {pendingAttachments.length} foto bukti siap dikirim
              </span>
            </div>
          )}

          {/* Mandatory Category Warning for Installer */}
          {isInstaller && !hasValidCategory && (
            <div className="px-3.5 py-2 bg-amber-50 dark:bg-amber-950/70 border-t border-amber-300 dark:border-amber-800 flex items-center gap-2 text-[11px] text-amber-900 dark:text-amber-200 font-semibold shrink-0">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>Pilih kategori chat di atas terlebih dahulu sebelum mengirim pesan.</span>
            </div>
          )}

          {/* Message Input Form */}
          <form
            onSubmit={e => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="p-3 bg-white dark:bg-[#1E1238] border-t border-[#E9E5F0] dark:border-[#35105E] shrink-0"
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept="image/jpeg,image/png,image/webp,image/jpg"
              multiple
              className="hidden"
            />
            <div className="flex items-center gap-2 bg-[#F7F6FA] dark:bg-[#160D29] rounded-xl p-1.5 shadow-inner border border-[#D8CCF3] dark:border-[#4B386B]">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-3d-icon w-9 h-9 rounded-lg flex items-center justify-center shrink-0 cursor-pointer"
                title="Unggah Lampiran/Foto Lapangan"
              >
                <ImageIcon className="w-4 h-4 text-[#7135B5] dark:text-[#DAB9FF]" />
              </button>

              <input
                type="text"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder={
                  isInstaller && !hasValidCategory
                    ? 'Pilih kategori chat terlebih dahulu...'
                    : `Tulis instruksi / pesan sebagai ${currentUser.name}...`
                }
                className="flex-1 min-w-0 bg-transparent px-2 py-1 text-xs text-[#211A2E] dark:text-white placeholder:text-[#8B8495] focus:outline-none"
              />

              <button
                type="submit"
                disabled={isSubmitting || (isInstaller && !hasValidCategory) || (!inputText.trim() && pendingAttachments.length === 0)}
                className="btn-3d-primary w-9 h-9 rounded-lg flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Kirim Pesan"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        </>
      )}

      {/* Fullscreen Lightbox / Zoom Modal */}
      {zoomImage && (
        <div
          className="fixed inset-0 z-70 bg-black/90 flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => setZoomImage(null)}
        >
          <div className="relative max-w-5xl max-h-[92vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setZoomImage(null)}
              className="absolute top-4 right-4 p-2 bg-black/70 text-white rounded-full hover:bg-rose-600 transition-colors z-10 cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={getSafePreviewUrl(zoomImage)}
              alt="Bukti Lapangan Zoom"
              referrerPolicy="no-referrer"
              className="max-w-full max-h-[88vh] object-contain rounded-2xl shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
};
