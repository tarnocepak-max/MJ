import { Ticket } from '../types/index.ts';

/**
 * Validates that latitude/longitude represent a real non-null-island geographic point.
 */
export function isValidCoordinatePair(lat?: number | null, lng?: number | null): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  // Reject Null Island (0, 0) fabricated fallback
  if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return false;
  return true;
}

/**
 * Formats coordinate pair to crisp 6-decimal GPS display string.
 */
export function formatCoordinates(lat?: number | null, lng?: number | null): string {
  if (!isValidCoordinatePair(lat, lng)) return '-';
  return `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
}

/**
 * Builds a Google Maps URL for exact GPS coordinates.
 */
export function buildGoogleMapsCoordinateUrl(lat?: number | null, lng?: number | null): string {
  if (!isValidCoordinatePair(lat, lng)) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`)}`;
}

/**
 * Opens exact GPS coordinates in Google Maps (new tab or native Google Maps app on mobile).
 */
export function openCoordinatesInGoogleMaps(lat?: number | null, lng?: number | null): boolean {
  const url = buildGoogleMapsCoordinateUrl(lat, lng);
  if (!url) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

/**
 * Builds a standardized Google Maps search query URL using actual customer address fields.
 * Format: https://www.google.com/maps/search/?api=1&query=ALAMAT_PELANGGAN
 */
export function buildGoogleMapsSearchUrl(ticket: Partial<Ticket>): { url: string; address: string } {
  if (!ticket) return { url: '', address: '' };

  const fields = [
    ticket.streetName,
    ticket.address,
    ticket.streetAlternatif,
    ticket.clusterName,
    ticket.area,
    ticket.city,
    ticket.postalCode
  ];

  const address = fields
    .filter((value): value is string =>
      typeof value === 'string' &&
      value.trim() !== '' &&
      value.trim() !== '-' &&
      value.toLowerCase() !== 'null' &&
      value.toLowerCase() !== 'undefined'
    )
    .map(value => value.trim())
    .filter((value, index, array) => array.indexOf(value) === index)
    .join(', ');

  if (!address) {
    return { url: '', address: '' };
  }

  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return { url, address };
}

/**
 * Opens Google Maps search directly in a new window/tab or launches the native Google Maps app on Android.
 */
export function openCustomerAddressInGoogleMaps(ticket: Partial<Ticket>, onEmpty?: () => void): boolean {
  const { url, address } = buildGoogleMapsSearchUrl(ticket);
  if (!url || !address) {
    if (onEmpty) {
      onEmpty();
    }
    return false;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
