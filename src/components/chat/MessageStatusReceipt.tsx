import React from 'react';
import { AlertCircle, Check, CheckCheck, Loader2, RotateCcw } from 'lucide-react';
import { TicketMessage } from '../../types';

interface MessageStatusReceiptProps {
  message: TicketMessage;
  senderId?: string;
  /** 'onDark' for Dispatch/Installer dark/purple outgoing bubbles, 'onLight' for light bubbles */
  variant?: 'onDark' | 'onLight';
  showLabel?: boolean;
  className?: string;
  onRetry?: (messageId: string) => void;
}

export const MessageStatusReceipt: React.FC<MessageStatusReceiptProps> = ({
  message,
  senderId,
  variant = 'onLight',
  showLabel = true,
  className = '',
  onRetry
}) => {
  if (message.deliveryStatus === 'sending') {
    return (
      <span
        className={`inline-flex items-center gap-1 select-none ${
          variant === 'onDark' ? 'text-white/80' : 'text-slate-500'
        } ${className}`}
        title="Mengirim pesan ke server..."
        data-receipt-state="sending"
      >
        <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
        {showLabel && (
          <span className="text-[10px] font-semibold tracking-tight leading-none">Mengirim...</span>
        )}
      </span>
    );
  }

  if (message.deliveryStatus === 'failed') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 select-none ${
          variant === 'onDark' ? 'text-rose-200' : 'text-rose-600'
        } ${className}`}
        title={message.localError || 'Gagal mengirim pesan'}
        data-receipt-state="failed"
      >
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        {showLabel && (
          <span className="text-[10px] font-semibold tracking-tight leading-none">Gagal</span>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              onRetry(message.id);
            }}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold underline underline-offset-2 cursor-pointer ${
              variant === 'onDark'
                ? 'bg-rose-950/50 text-white hover:bg-rose-900/70'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
            }`}
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>Kirim Ulang</span>
          </button>
        )}
      </span>
    );
  }

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
