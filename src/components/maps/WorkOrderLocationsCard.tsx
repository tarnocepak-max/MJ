import React, { useState } from 'react';
import {
  MapPin,
  Home,
  Radio,
  ExternalLink,
  Clock,
  Maximize2,
  X,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { Ticket, WorkOrderGeoLocation } from '../../types/index.ts';
import {
  buildGoogleMapsCoordinateUrl,
  formatCoordinates,
  isValidCoordinatePair
} from '../../services/mapsService.ts';
import { GeoLocationMiniMap } from './GeoLocationMiniMap.tsx';
import { getSafePreviewUrl } from '../../services/storageCompatibility.ts';
import { formatJakartaTimeOnly } from '../../services/workSessionService.ts';

interface WorkOrderLocationsCardProps {
  ticket: Ticket;
  compact?: boolean;
  onQuickCaptureHouse?: () => void;
  onQuickCaptureFat?: () => void;
  canQuickCapture?: boolean;
}

function formatCapturedDateTime(iso?: string): string {
  if (!iso) return '-';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  const datePart = dt.toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  return `${datePart} ${formatJakartaTimeOnly(iso)} WIB`;
}

export const WorkOrderLocationsCard: React.FC<WorkOrderLocationsCardProps> = ({
  ticket,
  compact = false,
  onQuickCaptureHouse,
  onQuickCaptureFat,
  canQuickCapture = false
}) => {
  const [previewPhoto, setPreviewPhoto] = useState<{ url: string; title: string } | null>(null);

  const renderLocationCard = (
    title: string,
    loc: WorkOrderGeoLocation | undefined,
    variant: 'house' | 'fat',
    onQuickCapture?: () => void
  ) => {
    const hasCoords = Boolean(loc && isValidCoordinatePair(loc.latitude, loc.longitude));
    const googleUrl = hasCoords && loc ? buildGoogleMapsCoordinateUrl(loc.latitude, loc.longitude) : '';
    const isHouse = variant === 'house';

    const accentIconCls = isHouse
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';

    const fallbackPhotoUrl = !loc?.photoUrl && Array.isArray(ticket.technicalReport?.photoSlots)
      ? ticket.technicalReport!.photoSlots.find(
          s => s.slotKey === (isHouse ? 'customer_house' : 'fat_attenuation')
        )?.url
      : loc?.photoUrl;

    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-[#0F172A] p-3 space-y-2.5 shadow-xs">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${accentIconCls}`}>
              {isHouse ? <Home className="w-4 h-4" /> : <Radio className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <span>{title}</span>
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                {isHouse ? 'Sumber: 5. Foto Rumah Pelanggan' : 'Sumber: 6. Foto Redaman FAT'}
              </div>
            </div>
          </div>

          {hasCoords && loc ? (
            <span
              className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold flex items-center gap-1 shrink-0 ${
                loc.geotagStatus === 'weak'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
              }`}
            >
              {loc.geotagStatus === 'weak' ? (
                <AlertTriangle className="w-3 h-3" />
              ) : (
                <CheckCircle2 className="w-3 h-3" />
              )}
              <span>{typeof loc.accuracyMeters === 'number' ? `±${Math.round(loc.accuracyMeters)}m` : 'GPS Valid'}</span>
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-mono text-[10px] font-semibold shrink-0">
              Belum Ada GPS
            </span>
          )}
        </div>

        {hasCoords && loc ? (
          <>
            <div className="flex items-center gap-2.5">
              {fallbackPhotoUrl && (
                <button
                  type="button"
                  onClick={() => setPreviewPhoto({ url: getSafePreviewUrl(fallbackPhotoUrl), title })}
                  className="relative w-14 h-14 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 shrink-0 group cursor-pointer bg-slate-100 dark:bg-slate-900"
                  title="Lihat Foto Bukti"
                >
                  <img
                    src={getSafePreviewUrl(fallbackPhotoUrl)}
                    alt={title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                  <span className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <Maximize2 className="w-3.5 h-3.5 text-white" />
                  </span>
                </button>
              )}

              <div className="min-w-0 flex-1 space-y-1 text-[11px]">
                <div className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums truncate">
                  {formatCoordinates(loc.latitude, loc.longitude)}
                </div>
                <div className="text-[10.5px] text-slate-500 dark:text-slate-400 flex items-center gap-1 truncate">
                  <Clock className="w-3 h-3 shrink-0" />
                  <span>{formatCapturedDateTime(loc.capturedAt)}</span>
                </div>
                {loc.technicianName && (
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                    Teknisi: <strong className="text-slate-700 dark:text-slate-200">{loc.technicianName}</strong>
                  </div>
                )}
              </div>
            </div>

            <GeoLocationMiniMap
              latitude={loc.latitude}
              longitude={loc.longitude}
              accuracyMeters={loc.accuracyMeters}
              geotagStatus={loc.geotagStatus}
              label={title}
              markerVariant={variant}
              heightClass={compact ? 'h-28' : 'h-36'}
              compact
            />

            {googleUrl && (
              <a
                href={googleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Buka Google Maps</span>
              </a>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B1222] p-3 text-center space-y-2">
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span>Lokasi belum tersedia — menunggu dokumentasi teknisi</span>
            </div>
            {canQuickCapture && onQuickCapture && (
              <button
                type="button"
                onClick={onQuickCapture}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold cursor-pointer"
              >
                Ambil {isHouse ? 'Foto Rumah' : 'Foto Redaman FAT'}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {renderLocationCard('Lokasi Rumah', ticket.houseLocation, 'house', onQuickCaptureHouse)}
        {renderLocationCard('Lokasi FAT', ticket.fatLocation, 'fat', onQuickCaptureFat)}
      </div>

      {previewPhoto && (
        <div
          className="fixed inset-0 z-[120] bg-black/90 flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => setPreviewPhoto(null)}
        >
          <div className="relative max-w-3xl max-h-[88vh]" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setPreviewPhoto(null)}
              className="absolute -top-3 -right-3 p-2 rounded-full bg-slate-900 text-white border border-white/20 hover:bg-rose-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <img
              src={previewPhoto.url}
              alt={previewPhoto.title}
              className="max-w-full max-h-[80vh] object-contain rounded-xl border border-white/15 shadow-2xl"
            />
            <div className="mt-2 text-center text-xs font-bold text-white">{previewPhoto.title}</div>
          </div>
        </div>
      )}
    </>
  );
};
