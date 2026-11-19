import { GeotagStatus } from '../types/index.ts';
import { formatJakartaTimeOnly } from './workSessionService.ts';
import { isValidCoordinatePair } from './mapsService.ts';

export type GpsSignalIndicator =
  | 'GPS_ACQUIRED'
  | 'WAITING_GPS'
  | 'GPS_WEAK_SIGNAL'
  | 'PERMISSION_DENIED'
  | 'GPS_UNAVAILABLE';

export interface GpsPositionSnapshot {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  altitudeMeters?: number;
  headingDeg?: number;
  speedMps?: number;
  capturedAtIso: string;
  locationSource: string;
  permissionStatus: string;
  geotagStatus: GeotagStatus;
  signalIndicator: GpsSignalIndicator;
}

export const RECOMMENDED_GPS_ACCURACY_METERS = 50;
export const ACCEPTABLE_GPS_ACCURACY_METERS = 150;

export function classifyGpsAccuracy(accuracyMeters?: number | null): {
  geotagStatus: GeotagStatus;
  signalIndicator: GpsSignalIndicator;
  label: string;
} {
  if (typeof accuracyMeters !== 'number' || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) {
    return {
      geotagStatus: 'missing',
      signalIndicator: 'GPS_UNAVAILABLE',
      label: 'Akurasi GPS Tidak Diketahui'
    };
  }
  if (accuracyMeters <= RECOMMENDED_GPS_ACCURACY_METERS) {
    return {
      geotagStatus: 'valid',
      signalIndicator: 'GPS_ACQUIRED',
      label: `GPS Valid (±${Math.round(accuracyMeters)}m)`
    };
  }
  if (accuracyMeters <= ACCEPTABLE_GPS_ACCURACY_METERS) {
    return {
      geotagStatus: 'weak',
      signalIndicator: 'GPS_WEAK_SIGNAL',
      label: `GPS Weak Signal (±${Math.round(accuracyMeters)}m)`
    };
  }
  return {
    geotagStatus: 'weak',
    signalIndicator: 'GPS_WEAK_SIGNAL',
    label: `Sinyal GPS Lemah (±${Math.round(accuracyMeters)}m)`
  };
}

export async function queryLocationPermissionStatus(): Promise<'granted' | 'prompt' | 'denied' | 'unsupported'> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
      return typeof navigator !== 'undefined' && 'geolocation' in navigator ? 'prompt' : 'unsupported';
    }
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state;
  } catch {
    return typeof navigator !== 'undefined' && 'geolocation' in navigator ? 'prompt' : 'unsupported';
  }
}

export function buildGpsSnapshotFromCoords(
  coords: GeolocationCoordinates,
  permissionStatus: string = 'granted'
): GpsPositionSnapshot | null {
  const lat = coords.latitude;
  const lng = coords.longitude;
  if (!isValidCoordinatePair(lat, lng)) {
    return null;
  }
  const acc = Number.isFinite(coords.accuracy) ? Math.max(0, Math.round(coords.accuracy)) : 999;
  const classified = classifyGpsAccuracy(acc);

  return {
    latitude: Number(lat.toFixed(7)),
    longitude: Number(lng.toFixed(7)),
    accuracyMeters: acc,
    altitudeMeters: typeof coords.altitude === 'number' && Number.isFinite(coords.altitude)
      ? Number(coords.altitude.toFixed(1))
      : undefined,
    headingDeg: typeof coords.heading === 'number' && Number.isFinite(coords.heading)
      ? Number(coords.heading.toFixed(1))
      : undefined,
    speedMps: typeof coords.speed === 'number' && Number.isFinite(coords.speed)
      ? Number(coords.speed.toFixed(2))
      : undefined,
    capturedAtIso: new Date().toISOString(),
    locationSource: 'device_gps_high_accuracy',
    permissionStatus,
    geotagStatus: classified.geotagStatus,
    signalIndicator: classified.signalIndicator
  };
}

export function acquireCurrentDeviceGps(options?: {
  timeoutMs?: number;
  maximumAgeMs?: number;
}): Promise<{ snapshot?: GpsPositionSnapshot; errorCode?: GpsSignalIndicator; errorMessage?: string }> {
  return new Promise(async resolve => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      resolve({
        errorCode: 'GPS_UNAVAILABLE',
        errorMessage: 'Perangkat atau browser tidak mendukung Geolocation API.'
      });
      return;
    }

    const perm = await queryLocationPermissionStatus();

    navigator.geolocation.getCurrentPosition(
      position => {
        const snapshot = buildGpsSnapshotFromCoords(position.coords, perm === 'unsupported' ? 'granted' : perm);
        if (!snapshot) {
          resolve({
            errorCode: 'GPS_UNAVAILABLE',
            errorMessage: 'Koordinat GPS perangkat tidak valid (0,0 atau di luar rentang).'
          });
          return;
        }
        resolve({ snapshot });
      },
      err => {
        if (err.code === err.PERMISSION_DENIED) {
          resolve({
            errorCode: 'PERMISSION_DENIED',
            errorMessage: 'Izin lokasi GPS ditolak oleh pengguna atau browser. Aktifkan izin lokasi untuk mencatat geotag foto.'
          });
        } else if (err.code === err.TIMEOUT) {
          resolve({
            errorCode: 'GPS_WEAK_SIGNAL',
            errorMessage: 'Waktu perolehan sinyal GPS habis (timeout). Pastikan GPS aktif & berada di area terbuka.'
          });
        } else {
          resolve({
            errorCode: 'GPS_UNAVAILABLE',
            errorMessage: 'Sinyal GPS tidak tersedia pada perangkat saat ini.'
          });
        }
      },
      {
        enableHighAccuracy: true,
        timeout: options?.timeoutMs ?? 12000,
        maximumAge: options?.maximumAgeMs ?? 0
      }
    );
  });
}

export interface PhotoWatermarkMetadata {
  woNumber: string;
  slotTitle: string;
  technicianName: string;
  customerName?: string;
  capturedAtIso: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  geotagStatus?: GeotagStatus;
}

/**
 * Draws a crisp, minimal dark-translucent field evidence badge onto the bottom edge
 * of a captured image canvas without obstructing the main central subject.
 */
export function applyGeoTagWatermarkToCanvas(
  canvas: HTMLCanvasElement,
  meta: PhotoWatermarkMetadata
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  if (w < 160 || h < 160) return;

  const pad = Math.max(12, Math.round(w * 0.018));
  const fontSize = Math.max(11, Math.min(20, Math.round(w * 0.017)));
  const lineH = Math.round(fontSize * 1.38);

  const validCoords = isValidCoordinatePair(meta.latitude, meta.longitude);
  const coordLine = validCoords
    ? `GPS: ${Number(meta.latitude).toFixed(6)}, ${Number(meta.longitude).toFixed(6)}${
        typeof meta.accuracyMeters === 'number' ? ` (±${Math.round(meta.accuracyMeters)}m)` : ''
      }`
    : 'GPS: Koordinat tidak tersedia';

  const d = new Date(meta.capturedAtIso);
  const dateStr = Number.isNaN(d.getTime())
    ? meta.capturedAtIso
    : `${d.toLocaleDateString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      })} ${formatJakartaTimeOnly(meta.capturedAtIso)} WIB`;

  const lines = [
    `MORAJAWS EVIDENCE • ${meta.woNumber} • ${meta.slotTitle.replace(/^\d+\.\s*/, '')}`,
    `Teknisi: ${meta.technicianName}${meta.customerName ? ` • ${meta.customerName}` : ''}`,
    `${coordLine} • ${dateStr}`
  ];

  const boxHeight = lines.length * lineH + pad * 1.3;
  const boxY = h - boxHeight;

  ctx.save();
  // Subtle dark gradient footer strip so central photo object remains 100% clear
  const grad = ctx.createLinearGradient(0, boxY - 14, 0, h);
  grad.addColorStop(0, 'rgba(11, 18, 34, 0)');
  grad.addColorStop(0.22, 'rgba(11, 18, 34, 0.78)');
  grad.addColorStop(1, 'rgba(11, 18, 34, 0.92)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, boxY - 14, w, boxHeight + 14);

  ctx.font = `600 ${fontSize}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.textBaseline = 'top';

  lines.forEach((line, idx) => {
    const y = boxY + pad * 0.55 + idx * lineH;
    ctx.fillStyle = idx === 0 ? '#93C5FD' : idx === 2 && validCoords ? '#6EE7B7' : '#F8FAFC';
    ctx.fillText(line, pad, y, w - pad * 2);
  });
  ctx.restore();
}
