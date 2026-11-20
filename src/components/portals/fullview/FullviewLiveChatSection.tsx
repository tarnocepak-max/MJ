import React from 'react';
import {
  AlertCircle,
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
import { getSafePreviewUrl } from '../../../services/storageCompatibility';
import { MessageStatusReceipt } from '../../chat/MessageStatusReceipt';

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
  return (
    <div
      ref={chatSectionRef}
      onClick={() => {
        if (!isChatActive) onActivateChat();
      }}
      className="bg-white rounded-xl p-3.5 border border-[#e8ddff] shadow-xs flex flex-col h-[420px]"
    >
      {/* Chat Header */}
      <div className="flex items-center justify-between pb-2.5 border-b border-[#e8ddff] shrink-0 gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#f3eaff] text-[#58149c] flex items-center justify-center border border-[#e8ddff] shrink-0">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="font-display font-bold text-[13.5px] text-[#1f1638] flex items-center gap-1.5">
              <span>Live Chat Koordinasi</span>
              {unreadChatCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-50 text-[#ba1a1a] border border-rose-200 tabular-nums">
                  {unreadChatCount > 99 ? '99+' : unreadChatCount} Baru
                </span>
              )}
            </h3>
            <div className="text-[10.5px] text-[#7d7484] font-mono truncate">
              WO: {activeTicket.woNumber}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {chatCategory && (
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold text-white flex items-center gap-1"
              style={{ backgroundColor: currentChatCategoryObj?.color || '#58149c' }}
            >
              <Tag className="w-2.5 h-2.5" />
              <span>#{chatCategory}</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>LIVE</span>
          </span>
        </div>
      </div>

      {/* Chat Conversation Area */}
      <div className="flex-1 p-3 my-2.5 overflow-y-auto space-y-2.5 bg-[#f8f1ff] rounded-xl border border-[#e8ddff]">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 text-[#7d7484] space-y-2">
            <div className="w-9 h-9 rounded-xl bg-white text-[#58149c] flex items-center justify-center border border-[#e8ddff]">
              <MessageCircle className="w-4 h-4" />
            </div>
            <h4 className="font-bold text-[#1f1638] text-xs">
              Belum Ada Pesan Koordinasi
            </h4>
            <p className="text-[11px] max-w-xs text-[#4b4452] leading-relaxed">
              Pilih kategori <strong className="text-[#58149c]">PROGRESS</strong> lalu kirim pesan atau foto Check-In untuk mencatat kehadiran lapangan.
            </p>
          </div>
        ) : (
          messages.map(msg => {
            const isMe = msg.senderId === currentUser.id || msg.senderRole === currentUser.role;
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
                  <span className={`font-bold ${isMe ? 'text-[#58149c]' : 'text-[#1f1638]'}`}>
                    {isMe ? 'Anda' : msg.senderName}
                  </span>
                  {msg.category && (
                    <span className="font-mono text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-white text-[#58149c] border border-[#e8ddff]">
                      #{msg.category}
                    </span>
                  )}
                  <span className="text-[10px] text-[#7d7484] font-mono tabular-nums">
                    {formattedTime}
                  </span>
                </div>

                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 space-y-1.5 text-xs shadow-2xs ${
                    isMe
                      ? 'bg-[#58149c] text-white rounded-tr-xs'
                      : 'bg-white text-[#1f1638] border border-[#e8ddff] rounded-tl-xs'
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
                          className="group relative rounded-lg overflow-hidden border border-[#e8ddff] bg-white cursor-pointer block"
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
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={chatMessagesEndRef} />
      </div>

      {/* Chat Error Alert */}
      {chatError && (
        <div className="mb-2 p-2 rounded-lg bg-rose-50 border border-rose-200 text-[#ba1a1a] text-xs flex items-center gap-1.5 shrink-0">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{chatError}</span>
        </div>
      )}

      {/* Pending Attachments Preview */}
      {chatAttachments.length > 0 && (
        <div className="mb-2 p-2 bg-[#f8f1ff] border border-[#e8ddff] rounded-xl flex items-center gap-2 overflow-x-auto shrink-0">
          {chatAttachments.map(att => (
            <div key={att.id} className="relative shrink-0 w-12 h-12 rounded-lg overflow-hidden border border-[#7135b5]">
              <img src={att.url} alt={att.fileName} className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => onRemoveAttachment(att.id)}
                className="absolute top-0.5 right-0.5 p-0.5 bg-[#ba1a1a] text-white rounded-full cursor-pointer"
                title="Hapus lampiran"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
          <span className="text-[11px] text-[#58149c] font-mono font-semibold">
            {chatAttachments.length} foto siap dikirim
          </span>
        </div>
      )}

      {/* Chat Input Controls */}
      {currentUser.role === 'leader' ? (
        <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-center text-xs text-amber-800 font-medium shrink-0">
          Mode Pantau: Leader hanya dapat membaca riwayat percakapan.
        </div>
      ) : (
        <form onSubmit={e => onSendMessage(e)} className="space-y-2 shrink-0">
          <select
            value={chatCategory}
            onChange={e => onSelectCategory(e.target.value)}
            aria-label="Kategori LiveChat"
            className="w-full px-3 py-2 rounded-xl bg-[#f8f1ff] border border-[#e8ddff] text-[#1f1638] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#7135b5] cursor-pointer"
          >
            <option value="">
              -- Pilih Kategori Chat Wajib (mis. PROGRESS) --
            </option>
            {activeChatCategories.map(cat => (
              <option key={cat.id} value={cat.name}>
                {cat.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5 bg-[#f8f1ff] p-1 rounded-xl border border-[#e8ddff]">
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
              className="p-2 rounded-lg bg-white border border-[#e8ddff] text-[#58149c] hover:bg-[#f3eaff] shrink-0 cursor-pointer transition-colors"
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
              className="flex-1 px-2.5 py-2 bg-transparent text-xs text-[#1f1638] placeholder:text-[#7d7484] focus:outline-none"
            />

            <button
              type="submit"
              disabled={
                isSendingChat ||
                !chatCategory ||
                chatCategory.toUpperCase() === 'UNCLASSIFIED' ||
                (!chatInputText.trim() && chatAttachments.length === 0)
              }
              className="p-2.5 mj-tactile-btn-primary disabled:opacity-40 disabled:cursor-not-allowed rounded-lg flex items-center justify-center shrink-0 cursor-pointer"
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
