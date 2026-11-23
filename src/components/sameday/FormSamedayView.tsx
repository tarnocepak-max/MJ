import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Zap,
  CheckCircle2,
  AlertTriangle,
  User,
  Phone,
  MapPin,
  Clock,
  Building2,
  Calendar,
  Radio,
  FileText
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { getJakartaDateString } from '../../services/appointmentDateParser';

export const FormSamedayView: React.FC = () => {
  const { createTicket, contractors, coverageAreas, currentUser } = useApp();
  const { toast } = useToast();

  const todayStr = getJakartaDateString(0);
  const [woNumber, setWoNumber] = useState(`WO${Date.now().toString().slice(-8)}`);
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [area, setArea] = useState(currentUser.area || coverageAreas[0]?.name || 'Jakarta Selatan');
  const [clusterName, setClusterName] = useState('');
  const [streetName, setStreetName] = useState('');
  const [streetAlternatif, setStreetAlternatif] = useState('');
  const [contractorName, setContractorName] = useState(currentUser.contractor || contractors[0]?.name || 'PT Mitra Jaringan Solusi');
  const [slotTime, setSlotTime] = useState('13:00 - 15:00 WIB');
  const [ticketCategory, setTicketCategory] = useState('New Installation FTTH (Sameday)');
  const [fdtCode, setFdtCode] = useState('FDT-JS-015');
  const [fatCode, setFatCode] = useState('FAT-JS-015-02');
  const [remarks, setRemarks] = useState('Sameday Urgent Dispatch');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!woNumber.trim() || !customerId.trim() || !customerName.trim() || !customerPhone.trim()) {
      toast.error('Mohon lengkapi field wajib (WO Number, Customer ID, Nama, No. HP).', 'Validasi Gagal');
      return;
    }

    if (!/^[0-9]{7}$/.test(customerId.trim())) {
      toast.error('Customer ID wajib tepat 7 digit angka murni (^[0-9]{7}$).', 'Format ID Tidak Valid');
      return;
    }

    setIsSubmitting(true);
    try {
      const newTicket = createTicket({
        woNumber: woNumber.trim().toUpperCase(),
        workOrderNumber: woNumber.trim().toUpperCase(),
        idCustomer: customerId.trim(),
        customerId: customerId.trim(),
        customerName: customerName.trim(),
        endUserName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        area: area.trim(),
        clusterName: clusterName.trim(),
        streetName: streetName.trim(),
        streetAlternatif: streetAlternatif.trim(),
        contactorName: contractorName.trim(),
        contractorName: contractorName.trim(),
        appointmentDate: todayStr,
        date: todayStr,
        slotTime: slotTime.trim(),
        ticketCategory: ticketCategory.trim(),
        fdtCode: fdtCode.trim(),
        fatCode: fatCode.trim(),
        remarksAgent: remarks.trim(),
        statusWOAgent: 'Assigned',
        statusWOInstaller: 'Unassigned',
        statusWhatsApp: 'ready',
        dateUpload: `${todayStr} ${new Date().toLocaleTimeString('id-ID').slice(0, 5)}`
      });

      toast.success(`Work Order Sameday ${newTicket.woNumber} berhasil dibuat dan diprioritaskan!`, 'Sameday Created');
      // Reset form
      setWoNumber(`WO${Date.now().toString().slice(-8)}`);
      setCustomerId('');
      setCustomerName('');
      setCustomerPhone('');
      setStreetName('');
      setStreetAlternatif('');
    } catch (err: any) {
      toast.error(err?.message || 'Gagal menyimpan tiket sameday.', 'Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // WO Same Day is strictly exclusive to Dispatch role
  if (currentUser.role !== 'dispatch') {
    return (
      <div className="p-8 text-center card-3d-lavender rounded-2xl border border-rose-200 dark:border-rose-900/50 max-w-lg mx-auto my-8 space-y-3">
        <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-full flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h2 className="font-display text-base font-extrabold text-[#26364A] dark:text-white">Akses Khusus Dispatcher</h2>
        <p className="text-xs text-[#52647A] dark:text-[#CEC0E8]">
          Fitur pendaftaran WO Same Day khusus diperuntukkan bagi role Dispatch. Peran Anda saat ini ({currentUser.role}) tidak memiliki izin akses.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Top Banner — Express Dispatch Maroon/Dark Purple 3D */}
      <div className="card-3d-lavender rounded-2xl p-4 sm:p-5 flex items-center justify-between gap-3 border-l-4 border-l-[#881337]">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#881337] via-[#6b103b] to-[#480123] text-white flex items-center justify-center font-bold shadow-[0_3px_0_#260112] shrink-0">
            <Zap className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#881337] dark:text-rose-300">
              EXPRESS SAMEDAY DISPATCH · WIB
            </div>
            <h2 className="font-display text-base font-extrabold text-[#26364A] dark:text-white flex flex-wrap items-center gap-2 mt-0.5">
              <span>Formulir Pendaftaran WO Sameday (Hari Ini)</span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2E1459] dark:text-[#DAB9FF] border border-[#C5BEEF] dark:border-[#5B35B1] whitespace-nowrap">
                Prioritas Tinggi (Express)
              </span>
            </h2>
            <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] mt-0.5">
              Pendaftaran tiket urgent dengan target pengerjaan di hari yang sama ({todayStr}).
            </p>
          </div>
        </div>
      </div>

      {/* Main Form Card */}
      <form onSubmit={handleSubmit} className="card-3d-lavender rounded-2xl p-4 sm:p-6 space-y-5 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block font-bold text-[#52647A] dark:text-[#CEC0E8] mb-1">
              Nomor Work Order (WO Number) *
            </label>
            <input
              type="text"
              required
              value={woNumber}
              onChange={e => setWoNumber(e.target.value.toUpperCase())}
              className="tactile-debossed-input w-full min-h-[44px] sm:min-h-[38px] px-3 py-2 rounded-xl font-mono font-bold text-[#5145A6] dark:text-[#DAB9FF]"
            />
          </div>
          <div>
            <label className="block font-bold text-[#52647A] dark:text-[#CEC0E8] mb-1">
              Customer ID (7 Digit Angka) *
            </label>
            <input
              type="text"
              required
              maxLength={7}
              placeholder="Contoh: 7399501"
              value={customerId}
              onChange={e => setCustomerId(e.target.value.replace(/\D/g, ''))}
              className="tactile-debossed-input w-full min-h-[44px] sm:min-h-[38px] px-3 py-2 rounded-xl font-mono font-semibold text-[#26364A] dark:text-white"
            />
          </div>
          <div>
            <label className="block font-bold text-[#52647A] dark:text-[#CEC0E8] mb-1">
              Nama Lengkap Pelanggan *
            </label>
            <input
              type="text"
              required
              placeholder="Nama customer"
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
              className="tactile-debossed-input w-full min-h-[44px] sm:min-h-[38px] px-3 py-2 rounded-xl font-medium text-[#26364A] dark:text-white"
            />
          </div>
          <div>
            <label className="block font-bold text-[#52647A] dark:text-[#CEC0E8] mb-1">
              Nomor Telepon / WhatsApp Pelanggan *
            </label>
            <input
              type="tel"
              required
              placeholder="Contoh: 081299887766"
              value={customerPhone}
              onChange={e => setCustomerPhone(e.target.value)}
              className="tactile-debossed-input w-full min-h-[42px] sm:min-h-[38px] px-3 py-2 rounded-xl font-mono text-[#26364A] dark:text-white"
            />
          </div>
          <div>
            <label className="block font-bold text-[#52647A] dark:text-[#CEC0E8] mb-1">
              Mitra Kontraktor Pelaksana *
            </label>
            <select
              value={contractorName}
              onChange={e => setContractorName(e.target.value)}
              className="tactile-debossed-input w-full min-h-[42px] sm:min-h-[38px] px-3 py-2 rounded-xl font-semibold text-[#26364A] dark:text-white"
            >
              {contractors.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-bold text-[#52647A] dark:text-[#CEC0E8] mb-1">
              Slot Waktu Pengerjaan *
            </label>
            <select
              value={slotTime}
              onChange={e => setSlotTime(e.target.value)}
              className="tactile-debossed-input w-full min-h-[42px] sm:min-h-[38px] px-3 py-2 rounded-xl font-medium text-[#26364A] dark:text-white"
            >
              <option value="09:00 - 11:00 WIB">09:00 - 11:00 WIB (Pagi)</option>
              <option value="11:00 - 13:00 WIB">11:00 - 13:00 WIB (Siang)</option>
              <option value="13:00 - 15:00 WIB">13:00 - 15:00 WIB (Sore 1)</option>
              <option value="15:00 - 17:00 WIB">15:00 - 17:00 WIB (Sore 2)</option>
            </select>
          </div>
          <div>
            <label className="block font-bold text-[#52647A] dark:text-[#CEC0E8] mb-1">
              Area / Wilayah *
            </label>
            <select
              value={area}
              onChange={e => setArea(e.target.value)}
              className="tactile-debossed-input w-full min-h-[42px] sm:min-h-[38px] px-3 py-2 rounded-xl font-semibold text-[#26364A] dark:text-white"
            >
              {coverageAreas.map(a => (
                <option key={a.id} value={a.name}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-bold text-[#52647A] dark:text-[#CEC0E8] mb-1">
              Cluster / Komplek
            </label>
            <input
              type="text"
              placeholder="Nama cluster"
              value={clusterName}
              onChange={e => setClusterName(e.target.value)}
              className="tactile-debossed-input w-full min-h-[42px] sm:min-h-[38px] px-3 py-2 rounded-xl text-[#26364A] dark:text-white"
            />
          </div>
          <div>
            <label className="block font-bold text-[#52647A] dark:text-[#CEC0E8] mb-1">
              Kategori Tiket
            </label>
            <input
              type="text"
              value={ticketCategory}
              onChange={e => setTicketCategory(e.target.value)}
              className="tactile-debossed-input w-full min-h-[42px] sm:min-h-[38px] px-3 py-2 rounded-xl text-[#26364A] dark:text-white"
            />
          </div>
        </div>

        <div>
          <label className="block font-bold text-[#52647A] dark:text-[#CEC0E8] mb-1">
            Alamat Lengkap Pemasangan *
          </label>
          <input
            type="text"
            required
            placeholder="Jalan, nomor rumah, RT/RW"
            value={streetName}
            onChange={e => setStreetName(e.target.value)}
            className="tactile-debossed-input w-full min-h-[42px] sm:min-h-[38px] px-3 py-2 rounded-xl text-[#26364A] dark:text-white"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block font-bold text-[#52647A] dark:text-[#CEC0E8] mb-1">
              Patokan / Landmark
            </label>
            <input
              type="text"
              placeholder="Dekat masjid / seberang ruko..."
              value={streetAlternatif}
              onChange={e => setStreetAlternatif(e.target.value)}
              className="tactile-debossed-input w-full min-h-[42px] sm:min-h-[38px] px-3 py-2 rounded-xl text-[#26364A] dark:text-white"
            />
          </div>
          <div>
            <label className="block font-bold text-[#52647A] dark:text-[#CEC0E8] mb-1">
              Kode FDT
            </label>
            <input
              type="text"
              value={fdtCode}
              onChange={e => setFdtCode(e.target.value.toUpperCase())}
              className="tactile-debossed-input w-full min-h-[42px] sm:min-h-[38px] px-3 py-2 rounded-xl font-mono text-[#26364A] dark:text-white"
            />
          </div>
          <div>
            <label className="block font-bold text-[#52647A] dark:text-[#CEC0E8] mb-1">
              Kode FAT
            </label>
            <input
              type="text"
              value={fatCode}
              onChange={e => setFatCode(e.target.value.toUpperCase())}
              className="tactile-debossed-input w-full min-h-[42px] sm:min-h-[38px] px-3 py-2 rounded-xl font-mono text-[#26364A] dark:text-white"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#DDE6F0] dark:border-[#35105E]">
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-3d-maroon w-full sm:w-auto justify-center px-6 py-2.5 min-h-[44px] font-extrabold rounded-xl cursor-pointer flex items-center gap-2 disabled:opacity-60"
          >
            <Zap className="w-4 h-4" />
            <span>{isSubmitting ? 'Mendaftarkan...' : 'Kirim & Terbitkan WO Sameday'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
