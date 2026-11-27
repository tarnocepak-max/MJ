import React from 'react';
import { MessageSquare } from 'lucide-react';
import type { ChatAttachment, ChatCategoryConfig, Ticket, TicketMessage, User } from '../../../types/index.ts';
import { ResponsiveModal } from '../../common/ResponsiveModal';
import { FullviewLiveChatSection } from './FullviewLiveChatSection';

export interface FloatingLiveChatModalProps {
  isOpen: boolean;
  onClose: () => void;
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

export const FloatingLiveChatModal: React.FC<FloatingLiveChatModalProps> = ({
  isOpen,
  onClose,
  activeTicket,
  unreadChatCount,
  ...chatProps
}) => {
  return (
    <ResponsiveModal
      isOpen={isOpen}
      onClose={onClose}
      title={`LiveChat · ${activeTicket.woNumber}`}
      subtitle={`${activeTicket.customerName || 'Pelanggan'} • ${activeTicket.area || '-'}`}
      icon={<MessageSquare className="w-4 h-4" />}
      headerExtra={
        unreadChatCount > 0 ? (
          <span className="px-2 py-0.5 rounded-full bg-[#D45B66] dark:bg-rose-600 text-white font-mono text-[10px] font-bold tabular-nums">
            {unreadChatCount > 99 ? '99+' : unreadChatCount} Baru
          </span>
        ) : null
      }
      size="2xl"
      mobileVariant="fullscreen"
      dialogClassName="sm:h-[88dvh]"
      bodyClassName="flex-1 min-h-0 flex flex-col overflow-hidden p-2.5 sm:p-4"
      variant="dark_purple"
      layerTier="nested"
      footer={
        <div className="w-full flex items-center justify-between gap-3 text-xs text-[#52647A] dark:text-[#C4B5D6]">
          <span>Terhubung langsung ke ruangan LiveChat WO {activeTicket.woNumber}</span>
          <button
            type="button"
            onClick={onClose}
            className="mj-btn-installer-neutral mj-btn-compact px-4 py-1.5 text-xs font-bold cursor-pointer shrink-0"
          >
            Tutup Chat
          </button>
        </div>
      }
    >
      <FullviewLiveChatSection
        activeTicket={activeTicket}
        unreadChatCount={unreadChatCount}
        {...chatProps}
      />
    </ResponsiveModal>
  );
};
