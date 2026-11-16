import React from 'react';
import { Check, CheckCheck } from 'lucide-react';
import { TicketMessage } from '../../types';

interface MessageStatusReceiptProps {
  message: TicketMessage;
  senderId?: string;
  /** 'onDark' for Dispatch/Installer dark/purple outgoing bubbles, 'onLight' for light bubbles */
  variant?: 'onDark' | 'onLight';
  showLabel?: boolean;
  className?: string;
}

export const MessageStatusReceipt: React.FC<MessageStatusReceiptProps> = ({
  message,
  senderId,
  variant = 'onLight',
  showLabel = true,
  className = ''
}) => {
  const effectiveSenderId = String(senderId || message.senderId || '').trim();
  const readers = Array.isArray(message.readBy)
    ? message.readBy.map(id => String(id || '').trim()).filter(id => id && id !== effectiveSenderId)
    : [];
  const delivered = Array.isArray(message.deliveredTo)
    ? message.deliveredTo.map(id => String(id || '').trim()).filter(id => id && id !== effectiveSenderId)
    : [];

  const isRead = readers.length > 0;
  const isDelivered = isRead || delivered.length > 0;

  const statusText = isRead ? 'Dibaca' : isDelivered ? 'Diterima' : 'Terkirim';

  const colorClass = isRead
    ? variant === 'onDark'
      ? 'text-[#38BDF8]'
      : 'text-[#0284C7]'
    : variant === 'onDark'
      ? 'text-white/75'
      : 'text-slate-400';

  const receiptTimeIso = isRead
    ? message.readAt?.[readers[0]]
    : isDelivered
      ? message.deliveredAt?.[delivered[0]]
      : message.timestamp;

  const formattedTime = receiptTimeIso
    ? (() => {
        try {
          return new Date(receiptTimeIso).toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Jakarta'
          });
        } catch {
          return '';
        }
      })()
    : '';

  const titleText = formattedTime ? `${statusText} • ${formattedTime} WIB` : statusText;

  return (
    <span
      className={`inline-flex items-center gap-1 select-none ${colorClass} ${className}`}
      title={titleText}
      data-receipt-state={isRead ? 'read' : isDelivered ? 'delivered' : 'sent'}
    >
      {isDelivered ? (
        <CheckCheck className="w-3.5 h-3.5 shrink-0 stroke-[2.25]" />
      ) : (
        <Check className="w-3.5 h-3.5 shrink-0 stroke-[2.25]" />
      )}
      {showLabel && (
        <span className="text-[10px] font-semibold tracking-tight leading-none">
          {statusText}
        </span>
      )}
    </span>
  );
};
