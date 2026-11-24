import React, { useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Building2,
  Phone,
  Navigation,
  Users2,
  MapPin,
  Inbox
} from 'lucide-react';

export const LocationBasecampView: React.FC = () => {
  const { contractors, currentUser, users } = useApp();

  const contractorHubs = useMemo(() => {
    const activeUsers = users.filter(u => !u.isDeleted && u.active !== false && !u.isArchived);
    const list = (contractors || []).filter(c => c.active !== false);
    const scoped =
      currentUser?.role === 'leader' && currentUser.contractor
        ? list.filter(
            c =>
              c.name.trim().toLowerCase() === currentUser.contractor!.trim().toLowerCase() ||
              c.id === currentUser.contractorId
          )
        : list;

    return scoped.map(c => {
      const contractorMatch = (val?: string) =>
        Boolean(val && val.trim().toLowerCase() === c.name.trim().toLowerCase());

      const leaders = activeUsers.filter(
        u => u.role === 'leader' && (u.contractorId === c.id || contractorMatch(u.contractor))
      );
      const installers = activeUsers.filter(
        u => u.role === 'installer' && (u.contractorId === c.id || contractorMatch(u.contractor))
      );
      const primaryLeader = leaders[0]?.name || c.leaderName || 'Belum ditugaskan';
      const primaryPhone = c.phone || leaders[0]?.phone || '';
      const areaLabel =
        c.coverageAreas && c.coverageAreas.length > 0 ? c.coverageAreas.join(', ') : 'Belum dipetakan';

      return {
        id: c.id,
        name: c.name,
        code: c.code,
        areaLabel,
        primaryArea: c.coverageAreas?.[0] || '',
        leaderName: primaryLeader,
        phone: primaryPhone,
        email: c.email || leaders[0]?.email || '',
        installerCount: installers.length,
        active: c.active
      };
    });
  }, [contractors, users, currentUser]);

  const handleOpenMaps = (areaQuery: string, contractorName: string) => {
    const query = areaQuery ? `${contractorName} ${areaQuery}` : contractorName;
    if (!query || typeof document === 'undefined') return;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
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
      <div className="card-3d-lavender rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#EAE8FF] to-[#DDF4F4] dark:from-[#35105E] dark:to-[#241145] border border-[#C5BEEF] dark:border-transparent text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center font-bold shadow-[0_3px_0_#D2DAEA] dark:shadow-[0_3px_0_#160D29] shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-[#26364A] dark:text-white flex flex-wrap items-center gap-2">
              <span>Direktori Kontraktor &amp; Area Operasional</span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#EAE8FF] text-[#5145A6] dark:bg-[#35105E] dark:text-[#DAB9FF] border border-[#C5BEEF] dark:border-[#5B35B1]/50">
                {contractorHubs.length} Mitra Aktif
              </span>
            </h2>
            <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] mt-0.5">
              Data kontraktor, korlap/leader penanggung jawab, area cakupan, dan jumlah teknisi aktif dari database aplikasi.
            </p>
          </div>
        </div>
      </div>

      {contractorHubs.length === 0 ? (
        <div className="card-3d-lavender rounded-2xl p-8 text-center space-y-2">
          <div className="w-11 h-11 rounded-2xl mx-auto flex items-center justify-center bg-[#F1F5FA] dark:bg-[#241145] text-[#8492A5] dark:text-[#A79BC0]">
            <Inbox className="w-5 h-5" />
          </div>
          <p className="text-sm font-bold text-[#26364A] dark:text-white">
            Belum ada data kontraktor aktif
          </p>
          <p className="text-xs text-[#52647A] dark:text-[#CEC0E8]">
            Tambahkan kontraktor dan area cakupan melalui Setup &gt; Konfigurasi Aplikasi.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {contractorHubs.map(hub => (
            <div
              key={hub.id}
              className="card-3d-lavender rounded-2xl p-5 space-y-4 flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2 border-b border-[#E2E8F0] dark:border-[#35105E] pb-3">
                  <div>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#DDF4F4] text-[#2E7D8B] dark:bg-[#35105E] dark:text-[#DAB9FF] border border-[#BDE4E8] dark:border-[#5B35B1]/50 inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      <span>{hub.areaLabel}</span>
                    </span>
                    <h3 className="font-display font-bold text-sm text-[#26364A] dark:text-white mt-1.5">
                      {hub.name}
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[#EAE8FF] text-[#5145A6] dark:bg-[#35105E] dark:text-[#DAB9FF] shrink-0">
                    {hub.code}
                  </span>
                </div>

                <div className="mj-tactile-well p-2.5 space-y-1.5 text-[11px] border border-[#DDE6F0] dark:border-[#35105E]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8492A5] dark:text-[#C5B3DF]">Leader / Korlap:</span>
                    <span className="font-semibold text-[#26364A] dark:text-white text-right">
                      {hub.primaryArea ? hub.leaderName : hub.leaderName}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8492A5] dark:text-[#C5B3DF]">Kontak Mitra:</span>
                    <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {hub.phone || 'Belum diisi'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8492A5] dark:text-[#C5B3DF]">Teknisi Aktif:</span>
                    <span className="font-bold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums inline-flex items-center gap-1">
                      <Users2 className="w-3 h-3" />
                      {hub.installerCount} Installer
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-[#E2E8F0] dark:border-[#35105E] flex items-center gap-2">
                {hub.phone && (
                  <a
                    href={`tel:${hub.phone}`}
                    className="btn-3d-lilac flex-1 py-2 px-3 min-h-[44px] sm:min-h-[38px] rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer text-center"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Hubungi</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => handleOpenMaps(hub.primaryArea, hub.name)}
                  className="btn-3d-primary flex-1 py-2 px-3 min-h-[44px] sm:min-h-[38px] rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>Cari di Maps</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
