import React, { useState, useEffect } from 'react';
import { Ticket } from '../../types';
import { useApp } from '../../context/AppContext';
import { renderWhatsAppMessage, buildWhatsAppClickToChatUrl, normalizePhoneNumber, isValidPhoneNumber } from '../../services/whatsappService';
import {
  MessageSquare,
  Copy,
  ExternalLink,
  Check,
  AlertTriangle,
  Info
} from 'lucide-react';
import { ResponsiveModal } from '../common/ResponsiveModal';

interface WhatsAppSendModalProps {
  ticket: Ticket;
  isOpen: boolean;
  onClose: () => void;
}

export const WhatsAppSendModal: React.FC<WhatsAppSendModalProps> = ({ ticket, isOpen, onClose }) => {
  const { templates, recordWhatsAppOpened, recordWhatsAppConfirmed, recordWhatsAppReschedule, recordWhatsAppUnreachable } = useApp();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(() => {
    const defaultTpl = templates.find(t => t.isDefault) || templates[0];
    return defaultTpl ? defaultTpl.id : '';
  });

  const [messageText, setMessageText] = useState<string>('');
  const [missingVars, setMissingVars] = useState<string[]>([]);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [confirmNotes, setConfirmNotes] = useState('');
  const [showConfirmForm, setShowConfirmForm] = useState(false);
  const [showRescheduleForm, setShowRescheduleForm] = useState(false);
  const [rescheduleNotes, setRescheduleNotes] = useState('');
  const [showUnreachableConfirm, setShowUnreachableConfirm] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Update rendered message when template or ticket changes
  useEffect(() => {
    if (!ticket) return;
    const currentTpl = templates.find(t => t.id === selectedTemplateId) || templates[0];
    if (currentTpl) {
      const { renderedText, missingVariables } = renderWhatsAppMessage(currentTpl.messageBody, ticket);
      setMessageText(renderedText);
      setMissingVars(missingVariables);
    }
  }, [selectedTemplateId, ticket, templates]);

  if (!isOpen || !ticket) return null;

  const normalizedPhone = normalizePhoneNumber(ticket.customerPhone);
  const isPhoneValid = isValidPhoneNumber(ticket.customerPhone);
  const { url, error: urlError } = buildWhatsAppClickToChatUrl(ticket.customerPhone, messageText);

  const handleOpenWhatsApp = () => {
    if (!url) return;
    // Log event and update status to opened_in_whatsapp
    recordWhatsAppOpened(ticket.id, url, messageText);
    setStatusMessage('WhatsApp Click-to-Chat dibuka! Status diperbarui menjadi "Opened in WA".');
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const handleCopyUrl = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(messageText);
      setCopiedMsg(true);
      setTimeout(() => setCopiedMsg(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  const handleVerifyConfirmation = () => {
    if (!confirmNotes.trim()) {
      setStatusMessage('Mohon cantumkan catatan verifikasi (misal: "Pelanggan membalas WA setuju jadwal").');
      return;
    }
    recordWhatsAppConfirmed(ticket.id, confirmNotes);
    setShowConfirmForm(false);
    setStatusMessage('Konfirmasi berhasil dicatat & diverifikasi.');
    setTimeout(() => {
      setStatusMessage(null);
      onClose();
    }, 1500);
  };

  const handleConfirmReschedule = () => {
    if (rescheduleNotes.trim()) {
      recordWhatsAppReschedule(ticket.id, rescheduleNotes.trim());
      setShowRescheduleForm(false);
      setRescheduleNotes('');
      onClose();
    }
  };

  const handleConfirmUnreachable = () => {
    recordWhatsAppUnreachable(ticket.id, 'Pelanggan tidak merespon chat atau nomor tidak aktif.');
    setShowUnreachableConfirm(false);
    onClose();
  };

  return (
    <ResponsiveModal
      isOpen={isOpen && Boolean(ticket)}
      onClose={onClose}
      size="md"
      mobileVariant="sheet"
      zIndexClass="z-60"
      icon={<MessageSquare className="w-4 h-4" />}
      title="WhatsApp Customer Confirmation"
      subtitle={
        <>
          WO: <span className="font-mono font-medium">{ticket.woNumber}</span> · {ticket.customerName}
        </>
      }
      footer={
        <div className="w-full flex flex-col-reverse sm:flex-row items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="btn-3d-ceramic w-full sm:w-auto px-4 py-2 text-xs font-bold rounded-xl min-h-[40px] text-center cursor-pointer"
          >
            Tutup
          </button>
          {url && isPhoneValid ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleOpenWhatsApp}
              className="btn-3d-emerald w-full sm:w-auto px-5 py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-2 min-h-[40px]"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Buka WhatsApp Web / App</span>
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="w-full sm:w-auto px-5 py-2 text-xs font-semibold text-white bg-slate-400 dark:bg-slate-700 rounded-xl cursor-not-allowed flex items-center justify-center gap-2 min-h-[40px]"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Nomor Tidak Valid</span>
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4 text-xs">
        {statusMessage && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 rounded-xl border border-emerald-200 dark:border-emerald-800 flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Recipient Details & Phone Normalization */}
        <div className="mj-tactile-well grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl">
          <div>
            <span className="text-[#7D7484] dark:text-[#A493C2] text-[11px] font-semibold block">Customer Contact</span>
            <span className="font-bold text-[#1F1638] dark:text-white">{ticket.customerName}</span>
            <div className="font-mono tabular-nums text-[#4B4452] dark:text-[#CABDE8] mt-0.5">
              {ticket.customerPhone || '(Belum ada nomor)'}
            </div>
          </div>
          <div>
            <span className="text-[#7D7484] dark:text-[#A493C2] text-[11px] font-semibold block">Normalized ID WhatsApp (+62)</span>
            <span className={`font-mono tabular-nums font-bold ${isPhoneValid ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {normalizedPhone || 'Format tidak valid'}
            </span>
            <span className="text-[10px] text-[#7D7484] dark:text-[#A493C2] block mt-0.5">
              {isPhoneValid ? 'Nomor valid siap dikirim via wa.me' : 'Periksa kembali nomor telepon pelanggan'}
            </span>
          </div>
        </div>

        {/* Template Selector */}
        <div>
          <label className="block text-xs font-bold text-[#1F1638] dark:text-[#E8DDFF] mb-1.5">
            Pilih Template Pesan
          </label>
          <select
            value={selectedTemplateId}
            onChange={e => setSelectedTemplateId(e.target.value)}
            className="tactile-debossed-input w-full px-3 py-2 text-xs rounded-xl text-[#1F1638] dark:text-white"
          >
            {templates.map(tpl => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name} ({tpl.category}) {tpl.isDefault ? '· [Default]' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Missing variables warning */}
        {missingVars.length > 0 && (
          <div className="p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Perhatian: Field placeholder tidak memiliki data di tiket ini</p>
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                Variabel kosong: <span className="font-mono">{missingVars.map(v => `{{${v}}}`).join(', ')}</span>. Sistem telah mengosongkannya agar tidak menampilkan "null" atau "undefined".
              </p>
            </div>
          </div>
        )}

        {/* Editable message editor */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-[#1F1638] dark:text-[#E8DDFF]">
              Isi Pesan (Dapat diedit sebelum membuka WhatsApp)
            </label>
            <button
              type="button"
              onClick={handleCopyMessage}
              className="text-[11px] text-[#5B289B] hover:text-[#35105E] dark:text-[#D8B4FE] dark:hover:text-white flex items-center gap-1 font-bold cursor-pointer"
            >
              {copiedMsg ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
              {copiedMsg ? 'Tersalin' : 'Salin Pesan'}
            </button>
          </div>
          <textarea
            rows={8}
            value={messageText}
            onChange={e => setMessageText(e.target.value)}
            className="tactile-debossed-input w-full p-3 font-mono text-xs rounded-xl text-[#1F1638] dark:text-[#E8DDFF] leading-relaxed"
          />
        </div>

        {/* Generated URL & Actions */}
        <div className="mj-tactile-well p-3 rounded-xl">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold text-[#4B4452] dark:text-[#CABDE8]">
              Generated Click-to-Chat URL
            </span>
            <button
              type="button"
              onClick={handleCopyUrl}
              disabled={!url}
              className="text-[11px] text-[#5B289B] hover:text-[#35105E] dark:text-[#D8B4FE] dark:hover:text-white flex items-center gap-1 font-bold disabled:opacity-50 cursor-pointer"
            >
              {copiedUrl ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
              {copiedUrl ? 'URL Tersalin' : 'Salin URL'}
            </button>
          </div>
          <div className="tactile-debossed-input p-2 rounded-lg font-mono text-[11px] text-[#4B4452] dark:text-[#E8DDFF] truncate select-all">
            {url || urlError || 'Tidak dapat membuat URL (cek nomor telepon)'}
          </div>
        </div>

        {/* Clarification banner */}
        <div className="p-2.5 bg-[#F3EAFF] dark:bg-[#241145] border border-[#DAB9FF] dark:border-[#4B2A85] rounded-xl text-[#35105E] dark:text-[#E8DDFF] text-[11px] flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-[#5B289B] dark:text-[#D8B4FE]" />
          <div>
            Mekanisme Click-to-Chat membuka WhatsApp dengan template terisi. Pesan baru terkirim setelah pengguna menekan tombol kirim di WhatsApp. Status tidak otomatis menjadi "Confirmed" sampai ada konfirmasi nyata dari pelanggan.
          </div>
        </div>

        {/* Manual verification form toggle */}
        {showConfirmForm ? (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800 space-y-2">
            <h5 className="font-bold text-emerald-900 dark:text-emerald-200 text-xs">
              Verifikasi Konfirmasi Pelanggan
            </h5>
            <p className="text-[11px] text-emerald-800 dark:text-emerald-300">
              Hanya gunakan jika pelanggan telah membalas pesan dan mengonfirmasi kesediaan waktu kunjungan.
            </p>
            <input
              type="text"
              placeholder="Catatan bukti konfirmasi (misal: Chat dibalas jam 10:05 setuju slot)"
              value={confirmNotes}
              onChange={e => setConfirmNotes(e.target.value)}
              className="tactile-debossed-input w-full px-2.5 py-1.5 text-xs rounded-lg text-[#1F1638] dark:text-white"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleVerifyConfirmation}
                className="btn-3d-emerald px-3 py-1.5 rounded-lg font-bold text-xs min-h-[36px] cursor-pointer"
              >
                Simpan Status Terkonfirmasi
              </button>
              <button
                type="button"
                onClick={() => setShowConfirmForm(false)}
                className="btn-3d-ceramic px-3 py-1.5 rounded-lg text-xs font-bold min-h-[36px] cursor-pointer"
              >
                Batal
              </button>
            </div>
          </div>
        ) : showRescheduleForm ? (
          <div className="p-3 bg-[#F3EAFF] dark:bg-[#241145] rounded-xl border border-[#DAB9FF] dark:border-[#4B2A85] space-y-2">
            <span className="font-bold text-[#35105E] dark:text-[#E8DDFF] block text-xs">
              Catat Permintaan Reschedule Pelanggan:
            </span>
            <input
              type="text"
              placeholder="Alasan / Jadwal baru yang diinginkan pelanggan..."
              value={rescheduleNotes}
              onChange={e => setRescheduleNotes(e.target.value)}
              className="tactile-debossed-input w-full px-2.5 py-1.5 rounded-lg text-[#1F1638] dark:text-white text-xs"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleConfirmReschedule}
                disabled={!rescheduleNotes.trim()}
                className="btn-3d-primary px-3 py-1.5 disabled:opacity-40 rounded-lg font-bold text-xs min-h-[36px] cursor-pointer"
              >
                Simpan Jadwal Ulang
              </button>
              <button
                type="button"
                onClick={() => setShowRescheduleForm(false)}
                className="btn-3d-ceramic px-3 py-1.5 rounded-lg text-xs font-bold min-h-[36px] cursor-pointer"
              >
                Batal
              </button>
            </div>
          </div>
        ) : showUnreachableConfirm ? (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 rounded-xl border border-rose-200 dark:border-rose-800 space-y-2">
            <span className="font-bold text-rose-900 dark:text-rose-200 block text-xs">
              Tandai Pelanggan Tidak Dapat Dihubungi (Unreachable)?
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleConfirmUnreachable}
                className="btn-3d-crimson px-3 py-1.5 rounded-lg font-bold text-xs min-h-[36px] cursor-pointer"
              >
                Ya, Tandai Unreachable
              </button>
              <button
                type="button"
                onClick={() => setShowUnreachableConfirm(false)}
                className="btn-3d-ceramic px-3 py-1.5 rounded-lg text-xs font-bold min-h-[36px] cursor-pointer"
              >
                Batal
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between pt-2 border-t border-[#E8DDFF] dark:border-[#3F2370] gap-2">
            <span className="text-[11px] text-[#7D7484] dark:text-[#CABDE8] font-semibold">Tindakan Lanjutan Verifikasi:</span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowConfirmForm(true)}
                className="btn-3d-emerald px-3 py-1.5 text-xs font-bold rounded-lg min-h-[36px] cursor-pointer"
              >
                Mark as Confirmed...
              </button>
              <button
                type="button"
                onClick={() => setShowRescheduleForm(true)}
                className="btn-3d-lilac px-3 py-1.5 text-xs font-bold rounded-lg min-h-[36px] cursor-pointer"
              >
                Reschedule...
              </button>
              <button
                type="button"
                onClick={() => setShowUnreachableConfirm(true)}
                className="btn-3d-crimson px-3 py-1.5 text-xs font-bold rounded-lg min-h-[36px] cursor-pointer"
              >
                Unreachable
              </button>
            </div>
          </div>
        )}
      </div>
    </ResponsiveModal>
  );
};
