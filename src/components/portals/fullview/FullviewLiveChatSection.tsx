import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ChevronUp,
  Loader2,
  MessageCircle,
  MessageSquare,
  Paperclip,
  Send,
  Tag,
  X
} from 'lucide-react';
import {
  ChatAttachment,
  ChatCategoryConfig,
  Ticket,
  TicketMessage,
  User
} from '../../../types/index.ts';
import { useApp } from '../../../context/AppContext';
import { getSafePreviewUrl } from '../../../services/storageCompatibility';
import { MessageStatusReceipt } from '../../chat/MessageStatusReceipt';
import { DropupSelect } from '../../common/DropupSelect';

interface FullviewLiveChatSectionProps {
  chatSectionRef: React.RefObject<HTMLDivElement | null>;
  chatMessagesEndRef: React.RefObject<HTMLDivElement | null>;
  chatInputRef: React.RefObject<HTMLInputElement | null>;
  chatFileInputRef: React.RefObject<HTMLInputElement | null>;
  activeTicket: Ticket;
  currentUser: User;
  messages: TicketMessage[];
  unreadChatCount: number;
  chatCategory: string;
  activeChatCategories: ChatCategoryConfig[];
  currentChatCategoryObj: ChatCategoryConfig | null;
  chatInputText: string;
  onChatInputChange: (val: string) => void;
  chatAttachments: ChatAttachment[];
  isSendingChat: boolean;
  chatError: string | null;
  isChatActive: boolean;
  onActivateChat: () => void;
  onSelectCategory: (cat: string) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveAttachment: (id: string) => void;
  onSendMessage: (e?: React.FormEvent, directText?: string) => void;
  onZoomImage: (url: string) => void;
}

const CANNED_QUICK_REPLIES = [
  {
    label: 'Tiba di Lokasi',
    categoryHint: 'PROGRESS',
    text: 'Teknisi sudah tiba di lokasi pelanggan dan melanjutkan pengecekan instalasi.'
  },
  {
    label: 'OPM Normal',
    categoryHint: 'PROGRESS',
    text: 'Pengukuran redaman OPM & aktivasi ONT normal sesuai SOP.'
  },
  {
    label: 'Kendala Lapangan',
    categoryHint: 'ISSUE',
    text: 'Mohon arahan Dispatch/Korlap terkait kendala teknis di lokasi.'
  }
];

export const FullviewLiveChatSection: React.FC<FullviewLiveChatSectionProps> = ({
  chatSectionRef,
  chatMessagesEndRef,
  chatInputRef,
  chatFileInputRef,
  activeTicket,
  currentUser,
  messages,
  unreadChatCount,
  chatCategory,
  activeChatCategories,
  currentChatCategoryObj,
  chatInputText,
  onChatInputChange,
  chatAttachments,
  isSendingChat,
  chatError,
  isChatActive,
  onActivateChat,
  onSelectCategory,
  onFileSelect,
  onRemoveAttachment,
  onSendMessage,
  onZoomImage
}) => {
  const {
    realtimeConnectionState,
    typingByTicketId,
    retryTicketMessage,
    loadOlderTicketMessages
  } = useApp();

  const streamRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevCountRef = useRef(messages.length);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  useEffect(() => {
    setHasOlderMessages(true);
    setShowJumpToLatest(false);
    isNearBottomRef.current = true;
  }, [activeTicket.id]);

  useEffect(() => {
    const prevCount = prevCountRef.current;
    prevCountRef.current = messages.length;
    const last = messages[messages.length - 1];
    const lastIsMine = Boolean(last && currentUser?.id && last.senderId === currentUser.id);
    if (isNearBottomRef.current || lastIsMine || prevCount === 0) {
      chatMessagesEndRef.current?.scrollIntoView({ behavior: prevCount === 0 ? 'auto' : 'smooth' });
      setShowJumpToLatest(false);
    } else if (messages.length > prevCount) {
      setShowJumpToLatest(true);
    }
  }, [messages.length, activeTicket.id, currentUser?.id, chatMessagesEndRef]);

  const handleStreamScroll = () => {
    const el = streamRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    isNearBottomRef.current = nearBottom;
    if (nearBottom) setShowJumpToLatest(false);
  };

  const handleLoadOlder = async () => {
    if (isLoadingOlder || !hasOlderMessages) return;
    const el = streamRef.current;
    const prevHeight = el?.scrollHeight || 0;
    const prevTop = el?.scrollTop || 0;
    setIsLoadingOlder(true);
    try {
      const res = await loadOlderTicketMessages(activeTicket.id, messages[0]?.timestamp, 50);
      setHasOlderMessages(res.hasMore);
      if (el && res.messages.length > 0) {
        window.requestAnimationFrame(() => {
          el.scrollTop = prevTop + (el.scrollHeight - prevHeight);
        });
      }
    } finally {
      setIsLoadingOlder(false);
    }
  };

  const activeTypers = (typingByTicketId[activeTicket.id] || []).filter(
    t => t.isTyping && t.userId !== currentUser?.id && Date.parse(t.expiresAt) > Date.now()
  );

  const hasUploadingAttachment = chatAttachments.some(a => a.uploadStatus === 'uploading');

  const handleQuickReply = (chip: (typeof CANNED_QUICK_REPLIES)[number]) => {
    onActivateChat();
    const matchedCat = activeChatCategories.find(
      c => c.name.toUpperCase() === chip.categoryHint.toUpperCase()
    );
    if (matchedCat) {
      onSelectCategory(matchedCat.name);
    }
    onChatInputChange(chip.text);
    setTimeout(() => chatInputRef.current?.focus(), 60);
  };

  return (
    <div
      ref={chatSectionRef}
      onClick={() => {
        if (!isChatActive) onActivateChat();
      }}
      className="bg-white/95 dark:bg-[#1E1238] rounded-xl p-3 sm:p-4 border border-[#DDE6F0] dark:border-[#35105E] shadow-xs flex flex-col flex-1 h-full min-h-0"
    >
      {/* Chat Header */}
      <div className="flex items-center justify-between pb-2.5 border-b border-[#DDE6F0] dark:border-[#35105E] shrink-0 gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#EAE8FF] dark:bg-[#2A194B] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center border border-[#DCE3F2] dark:border-[#4B386B] shrink-0">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="font-display font-bold text-[13.5px] text-[#26364A] dark:text-[#f5eeff] flex items-center gap-1.5">
              <span>Live Chat Koordinasi</span>
              {unreadChatCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#FCE9EB] dark:bg-rose-950/60 text-[#9B2C37] dark:text-rose-300 border border-[#F3C5CA] dark:border-rose-800/60 tabular-nums">
                  {unreadChatCount > 99 ? '99+' : unreadChatCount} Baru
                </span>
              )}
            </h3>
            <div className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] font-mono truncate">
              WO: {activeTicket.woNumber}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {chatCategory && (
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold text-white flex items-center gap-1"
              style={{ backgroundColor: currentChatCategoryObj?.color || '#6657C8' }}
            >
              <Tag className="w-2.5 h-2.5" />
              <span>#{chatCategory}</span>
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
              realtimeConnectionState === 'connected'
                ? 'text-[#218A63] dark:text-emerald-300 bg-[#E4F5EC] dark:bg-emerald-950/50 border-[#B7E4CC] dark:border-emerald-700/60'
                : realtimeConnectionState === 'reconnecting' || realtimeConnectionState === 'connecting'
                ? 'text-[#9D661F] dark:text-amber-300 bg-[#FFF2D9] dark:bg-amber-950/50 border-[#F2CF95] dark:border-amber-700/60'
                : 'text-[#9B2C37] dark:text-rose-300 bg-[#FCE9EB] dark:bg-rose-950/50 border-[#F3C5CA] dark:border-rose-700/60'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                realtimeConnectionState === 'connected'
                  ? 'bg-[#218A63] dark:bg-emerald-500 animate-pulse'
                  : realtimeConnectionState === 'reconnecting' || realtimeConnectionState === 'connecting'
                  ? 'bg-[#C88735] animate-pulse'
                  : 'bg-[#D45B66]'
              }`}
            />
            <span>
              {realtimeConnectionState === 'connected'
                ? 'LIVE'
                : realtimeConnectionState === 'reconnecting'
                ? 'RECONNECT'
                : realtimeConnectionState === 'connecting'
                ? 'CONNECTING'
                : 'TERPUTUS'}
            </span>
          </span>
        </div>
      </div>

      {/* Chat Conversation Area */}
      <div
        ref={streamRef}
        onScroll={handleStreamScroll}
        className="flex-1 min-h-0 p-3 my-2.5 overflow-y-auto space-y-2.5 bg-[#F8FAFD] dark:bg-[#160D29] rounded-xl border border-[#DDE6F0] dark:border-[#35105E] relative"
      >
        {messages.length >= 25 && hasOlderMessages && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleLoadOlder}
              disabled={isLoadingOlder}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] text-[10.5px] font-semibold text-[#5145A6] dark:text-[#DAB9FF] cursor-pointer disabled:opacity-50"
            >
              {isLoadingOlder ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronUp className="w-3 h-3" />}
              <span>{isLoadingOlder ? 'Memuat...' : 'Muat pesan sebelumnya'}</span>
            </button>
          </div>
        )}
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 text-[#8492A5] dark:text-[#A79BC0] space-y-2">
            <div className="w-9 h-9 rounded-xl bg-white dark:bg-[#1E1238] text-[#6657C8] dark:text-[#DAB9FF] flex items-center justify-center border border-[#DDE6F0] dark:border-[#35105E]">
              <MessageCircle className="w-4 h-4" />
            </div>
            <h4 className="font-bold text-[#26364A] dark:text-[#f5eeff] text-xs">
              Belum Ada Pesan Koordinasi
            </h4>
            <p className="text-[11px] max-w-xs text-[#52647A] dark:text-[#C4B5D6] leading-relaxed">
              Pilih kategori pesan lalu kirim update lapangan atau lampiran foto ke tim Dispatch &amp; Korlap.
            </p>
          </div>
        ) : (
          messages.map(msg => {
            const isMe = Boolean(
              currentUser?.id && msg.senderId ? msg.senderId === currentUser.id : msg.senderRole === currentUser?.role
            );
            const formattedTime = new Date(msg.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            });

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} space-y-1`}
              >
                <div className="flex items-center gap-1.5 text-[10.5px]">
                  <span className={`font-bold ${isMe ? 'text-[#5145A6] dark:text-[#DAB9FF]' : 'text-[#26364A] dark:text-[#f5eeff]'}`}>
                    {isMe ? 'Anda' : msg.senderName}
                  </span>
                  {msg.category && (
                    <span className="font-mono text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-white dark:bg-[#2A194B] text-[#5145A6] dark:text-[#DAB9FF] border border-[#DCE3F2] dark:border-[#4B386B]">
                      #{msg.category}
                    </span>
                  )}
                  <span className="text-[10px] text-[#8492A5] dark:text-[#A79BC0] font-mono tabular-nums">
                    {formattedTime}
                  </span>
                </div>

                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 space-y-1.5 text-xs shadow-2xs ${
                    isMe
                      ? 'bg-[#6657C8] dark:bg-[#58149c] text-white rounded-tr-xs'
                      : 'bg-white dark:bg-[#1E1238] text-[#26364A] dark:text-[#f5eeff] border border-[#DDE6F0] dark:border-[#35105E] rounded-tl-xs'
                  }`}
                >
                  {msg.text && (
                    <p className="leading-relaxed whitespace-pre-wrap break-words">
                      {msg.text}
                    </p>
                  )}

                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                      {msg.attachments.map(att => (
                        <button
                          key={att.id}
                          type="button"
                          onClick={() => onZoomImage(att.url)}
                          className="group relative rounded-lg overflow-hidden border border-[#DDE6F0] dark:border-[#35105E] bg-white dark:bg-[#160D29] cursor-pointer block"
                        >
                          <img
                            src={getSafePreviewUrl(att.url)}
                            alt={att.fileName}
                            className="w-full h-24 object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}

                  {isMe && (
                    <div className="flex justify-end pt-0.5">
                      <MessageStatusReceipt
                        message={msg}
                        senderId={currentUser.id}
                        variant="onDark"
                        showLabel={true}
                        onRetry={retryTicketMessage}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        {activeTypers.length > 0 && (
          <div className="text-[11px] text-[#5145A6] dark:text-[#DAB9FF] italic px-1">
            {activeTypers.map(t => t.userName).join(', ')} sedang mengetik...
          </div>
        )}
        <div ref={chatMessagesEndRef} />
      </div>

      {showJumpToLatest && (
        <div className="flex justify-end -mt-1 mb-1.5">
          <button
            type="button"
            onClick={() => {
              chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
              setShowJumpToLatest(false);
              isNearBottomRef.current = true;
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#6657C8] text-white text-[10.5px] font-bold shadow cursor-pointer"
          >
            <ArrowDown className="w-3 h-3" />
            <span>Pesan baru</span>
          </button>
        </div>
      )}

      {/* Chat Error Alert */}
      {chatError && (
        <div className="mb-2 p-2 rounded-lg bg-[#FCE9EB] dark:bg-rose-950/50 border border-[#F3C5CA] dark:border-rose-800/60 text-[#9B2C37] dark:text-rose-300 text-xs flex items-center gap-1.5 shrink-0">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{chatError}</span>
        </div>
      )}

      {/* Pending Attachments Preview */}
      {chatAttachments.length > 0 && (
        <div className="mb-2 p-2 bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] rounded-xl flex items-center gap-2 overflow-x-auto shrink-0">
          {chatAttachments.map(att => (
            <div
              key={att.id}
              className={`relative shrink-0 w-12 h-12 rounded-lg overflow-hidden border ${
                att.uploadStatus === 'failed'
                  ? 'border-rose-500'
                  : att.uploadStatus === 'uploading'
                  ? 'border-amber-400'
                  : 'border-[#6657C8] dark:border-[#7135b5]'
              }`}
            >
              <img src={getSafePreviewUrl(att.url)} alt={att.fileName} className="w-full h-full object-cover" />
              {att.uploadStatus === 'uploading' && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                </div>
              )}
              <button
                type="button"
                onClick={() => onRemoveAttachment(att.id)}
                className="absolute top-0.5 right-0.5 p-0.5 bg-[#D45B66] dark:bg-[#ba1a1a] text-white rounded-full cursor-pointer"
                title="Hapus lampiran"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
          <span className="text-[11px] text-[#5145A6] dark:text-[#DAB9FF] font-mono font-semibold">
            {hasUploadingAttachment ? 'Mengunggah foto...' : `${chatAttachments.length} foto siap dikirim`}
          </span>
        </div>
      )}

      {/* Chat Input Controls */}
      {currentUser.role === 'leader' ? (
        <div className="p-2.5 bg-[#FFF2D9] dark:bg-amber-950/40 border border-[#F2CF95] dark:border-amber-700/60 rounded-xl text-center text-xs text-[#9D661F] dark:text-amber-300 font-medium shrink-0">
          Mode Pantau: Leader hanya dapat membaca riwayat percakapan.
        </div>
      ) : (
        <form onSubmit={e => onSendMessage(e)} className="space-y-2 shrink-0">
          {/* Quick Reply Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {CANNED_QUICK_REPLIES.map(chip => (
              <button
                key={chip.label}
                type="button"
                onClick={() => handleQuickReply(chip)}
                className="mj-btn-installer-neutral mj-btn-xs px-2.5 py-1 text-[10.5px] font-bold whitespace-nowrap shrink-0 cursor-pointer"
              >
                + {chip.label}
              </button>
            ))}
          </div>

          <DropupSelect
            value={chatCategory}
            onChange={val => onSelectCategory(val)}
            ariaLabel="Kategori LiveChat"
            placeholder="-- Pilih Kategori Chat Wajib (mis. PROGRESS) --"
            options={activeChatCategories.map(cat => ({
              value: cat.name,
              label: `#${cat.name}`,
              description: cat.description || undefined
            }))}
          />

          <div className="flex items-center gap-1.5 bg-[#F8FAFD] dark:bg-[#160D29] p-1 rounded-xl border border-[#DDE6F0] dark:border-[#35105E]">
            <input
              type="file"
              ref={chatFileInputRef}
              onChange={onFileSelect}
              accept="image/jpeg,image/png,image/webp,image/jpg"
              multiple
              className="hidden"
            />
            <button
              type="button"
              onClick={() => chatFileInputRef.current?.click()}
              className="mj-btn-icon-3d-installer w-9 h-9 shrink-0 cursor-pointer"
              title="Lampirkan foto ke chat"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <input
              ref={chatInputRef}
              type="text"
              value={chatInputText}
              onFocus={onActivateChat}
              onChange={e => onChatInputChange(e.target.value)}
              placeholder={!chatCategory ? 'Pilih kategori chat dahulu...' : 'Tulis pesan koordinasi...'}
              className="flex-1 px-2.5 py-2 bg-transparent text-xs text-[#26364A] dark:text-[#f5eeff] placeholder:text-[#8492A5] dark:placeholder:text-[#A79BC0] focus:outline-none"
            />

            <button
              type="submit"
              disabled={
                isSendingChat ||
                hasUploadingAttachment ||
                !chatCategory ||
                chatCategory.toUpperCase() === 'UNCLASSIFIED' ||
                (!chatInputText.trim() && chatAttachments.filter(a => a.uploadStatus !== 'failed').length === 0)
              }
              className={`mj-btn-installer-primary mj-btn-compact px-3 py-2 shrink-0 cursor-pointer ${
                isSendingChat ? 'mj-btn-loading' : ''
              }`}
              title="Kirim pesan"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
