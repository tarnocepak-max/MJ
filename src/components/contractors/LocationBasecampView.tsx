import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { BasecampLocation } from '../../types';
import {
  MapPin,
  Building2,
  Phone,
  User,
  Users2,
  Navigation,
  ExternalLink,
  Plus,
  CheckCircle2,
  Edit2
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';

export const LocationBasecampView: React.FC = () => {
  const { contractors, currentUser, users } = useApp();
  const { toast } = useToast();

  const [basecamps, setBasecamps] = useState<BasecampLocation[]>([
    {
      id: 'bc-1',
      contractorId: 'c-mjs',
      contractorName: 'PT Mitra Jaringan Solusi',
      name: 'Basecamp Operasional Jakarta Selatan',
      area: 'Jakarta Selatan',
      address: 'Jl. Fatmawati Raya No. 42A, Cilandak Barat, Jakarta Selatan 12430',
      latitude: -6.2921,
      longitude: 106.7974,
      phone: '081288990011',
      leaderName: 'Hendra Gunawan (Leader MJS)',
      installerCount: 8,
      active: true
    },
    {
      id: 'bc-2',
      contractorId: 'c-kcs',
      contractorName: 'PT Kencana Solusindo',
      name: 'Basecamp Operasional Jakarta Barat',
      area: 'Jakarta Barat',
      address: 'Komplek Ruko Permata Taman Palem Blok B No. 15, Cengkareng, Jakarta Barat 11730',
      latitude: -6.1423,
      longitude: 106.7289,
      phone: '085711223344',
      leaderName: 'Dedi Kurniawan (Leader KCS)',
      installerCount: 6,
      active: true
    },
    {
      id: 'bc-3',
      contractorId: 'c-cfn',
      contractorName: 'PT Cipta Fiber Nusantara',
      name: 'Basecamp BSD & Tangerang Selatan',
      area: 'Tangerang Selatan',
      address: 'Ruko Golden Boulevard Blok W2 No. 8, BSD City, Serpong, Tangerang Selatan 15322',
      latitude: -6.3015,
      longitude: 106.6854,
      phone: '081822334455',
      leaderName: 'Ahmad Fauzi',
      installerCount: 5,
      active: true
    }
  ]);

  const [selectedBasecamp, setSelectedBasecamp] = useState<BasecampLocation>(basecamps[0]);

  // Open Google Maps without window.open
  const handleOpenMaps = (bc: BasecampLocation) => {
    const url =
      bc.latitude && bc.longitude
        ? `https://www.google.com/maps/search/?api=1&query=${bc.latitude},${bc.longitude}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(bc.address)}`;
    if (typeof document === 'undefined') return;
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="card-3d-lavender rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#EAE8FF] to-[#DDF4F4] dark:from-[#35105E] dark:to-[#241145] border border-[#C5BEEF] dark:border-transparent text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center font-bold shadow-[0_3px_0_#D2DAEA] dark:shadow-[0_3px_0_#160D29] shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-[#26364A] dark:text-white flex flex-wrap items-center gap-2">
              <span>Location Basecamp &amp; Hub Lapangan Mitra</span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#EAE8FF] text-[#5145A6] dark:bg-[#35105E] dark:text-[#DAB9FF] border border-[#C5BEEF] dark:border-[#5B35B1]/50">
                Pusat Armada &amp; Material
              </span>
            </h2>
            <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] mt-0.5">
              Direktori titik kumpul armada teknisi, gudang dropcore/modem, dan kontak koordinasi basecamp mitra kontraktor.
            </p>
          </div>
        </div>
      </div>

      {/* Grid of Basecamps */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {basecamps.map(bc => (
          <div
            key={bc.id}
            className="card-3d-lavender rounded-2xl p-5 space-y-4 flex flex-col justify-between"
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2 border-b border-[#E2E8F0] dark:border-[#35105E] pb-3">
                <div>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#DDF4F4] text-[#2E7D8B] dark:bg-[#35105E] dark:text-[#DAB9FF] border border-[#BDE4E8] dark:border-[#5B35B1]/50">
                    {bc.area}
                  </span>
                  <h3 className="font-display font-bold text-sm text-[#26364A] dark:text-white mt-1.5">
                    {bc.name}
                  </h3>
                </div>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 mt-1 shrink-0 ring-2 ring-emerald-500/25" />
              </div>

              <div className="space-y-2 text-xs">
                <div className="text-[#52647A] dark:text-[#CEC0E8]">
                  <strong className="text-[#26364A] dark:text-white block mb-0.5">Kontraktor:</strong>
                  {bc.contractorName}
                </div>

                <div className="text-[#52647A] dark:text-[#CEC0E8]">
                  <strong className="text-[#26364A] dark:text-white block mb-0.5">Alamat Basecamp:</strong>
                  {bc.address}
                </div>

                <div className="mj-tactile-well p-2.5 space-y-1.5 text-[11px] border border-[#DDE6F0] dark:border-[#35105E]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8492A5] dark:text-[#C5B3DF]">Leader / Korlap:</span>
                    <span className="font-semibold text-[#26364A] dark:text-white text-right">{bc.leaderName}</span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8492A5] dark:text-[#C5B3DF]">Hotline Basecamp:</span>
                    <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">{bc.phone}</span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8492A5] dark:text-[#C5B3DF]">Kekuatan Armada:</span>
                    <span className="font-bold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">{bc.installerCount} Teknisi Aktif</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-[#E2E8F0] dark:border-[#35105E] flex items-center gap-2">
              <a
                href={`tel:${bc.phone}`}
                className="btn-3d-lilac flex-1 py-2 px-3 min-h-[44px] sm:min-h-[38px] rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer text-center"
              >
                <Phone className="w-3.5 h-3.5" />
                <span>Hubungi</span>
              </a>
              <button
                type="button"
                onClick={() => handleOpenMaps(bc)}
                className="btn-3d-primary flex-1 py-2 px-3 min-h-[44px] sm:min-h-[38px] rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>Rute Maps</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
