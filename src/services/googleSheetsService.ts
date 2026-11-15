import { Ticket } from '../types/index.ts';
import { GoogleSpreadsheetMeta } from '../types/sheets.ts';

// Pure Google Identity Services (GIS) OAuth configuration (Zero Firebase dependency)
const getGoogleOAuthClientId = (): string => {
  return (import.meta as any).env?.VITE_GOOGLE_OAUTH_CLIENT_ID || '';
};

// In-Memory Token Cache (MANDATORY: Never store in localStorage or sessionStorage)
let cachedAccessToken: string | null = null;
let cachedGoogleUser: any = null;
let globalGISTokenClient: any = null;

export const STANDARD_SHEET_HEADERS = [
  'WO Number',
  'Ticket Number',
  'Date',
  'Appointment Date',
  'ID Customer',
  'Customer Name',
  'Customer Phone',
  'Customer Phone 2',
  'Area',
  'Cluster Name',
  'Street Name',
  'Street Alternatif',
  'Contactor Name',
  'Leader Name',
  'Corlap Contact',
  'Installer Name',
  'Installer Contact',
  'Slot Time',
  'FDT Code',
  'FAT Code',
  'Port FAT',
  'Ticket Category',
  'Status WO Agent',
  'Status WO Installer',
  'Remarks WO Installer',
  'Remarks Agent',
  'Work Result',
  'Root Cause Category',
  'Root Cause Sub Category',
  'Optical Power Rx',
  'ONT Serial Number',
  'Router Serial Number',
  'Date Assign Agent',
  'Date Assign Technician',
  'Date Upload',
  'File Name',
  'Agent ID',
  'Updated At',
  'Updated By'
];

/**
 * Check cached in-memory Google OAuth session state on mount
 */
export const initGoogleAuth = (
  onAuthSuccess?: (user: any, token: string) => void,
  onAuthFailure?: () => void
): (() => void) => {
  if (cachedGoogleUser && cachedAccessToken) {
    onAuthSuccess?.(cachedGoogleUser, cachedAccessToken);
  } else {
    onAuthFailure?.();
  }
  return () => {};
};

/**
 * Initialize Google Identity Services (GIS) Token Client once on page load
 */
export const initGISTokenClient = (
  onSuccess: (data: { user: any; accessToken: string }) => void,
  onError: (err: Error) => void
): boolean => {
  const google = (window as any).google;
  if (!google?.accounts?.oauth2) {
    return false;
  }

  const clientId = getGoogleOAuthClientId();
  if (!clientId) {
    return false;
  }

  try {
    globalGISTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file email profile openid',
      error_callback: (err: any) => {
        console.warn('GIS error_callback received:', err);
        const msg = err?.message || err?.type || 'Jendela login diblokir oleh browser.';
        onError(new Error(
          msg === 'popup_failed_to_open'
            ? 'Browser memblokir pop-up. Harap izinkan pop-up untuk situs ini atau gunakan opsi Token Manual di bawah.'
            : `Gagal membuka jendela autentikasi: ${msg}`
        ));
      },
      callback: async (resp: any) => {
        if (resp.error) {
          onError(new Error(`Google OAuth error: ${resp.error_description || resp.error}`));
          return;
        }
        if (!resp.access_token) {
          onError(new Error('Tidak ada access token yang diterima dari Google.'));
          return;
        }

        const token = resp.access_token;
        cachedAccessToken = token;

        // Fetch user profile from Google userinfo
        try {
          const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (userRes.ok) {
            const profile = await userRes.json();
            const userObj = {
              displayName: profile.name || profile.email || 'Super Admin (Google)',
              email: profile.email || '',
              photoURL: profile.picture || '',
              uid: profile.sub || 'google-user'
            };
            cachedGoogleUser = userObj;
            onSuccess({ user: cachedGoogleUser, accessToken: token });
            return;
          }
        } catch (e) {
          console.warn('Could not fetch userinfo, using token user:', e);
        }

        const fallbackUser = {
          displayName: 'Super Admin (Google Sheets)',
          email: '',
          photoURL: '',
          uid: 'google-oauth-user'
        };
        cachedGoogleUser = fallbackUser;
        onSuccess({ user: cachedGoogleUser, accessToken: token });
      }
    });
    return true;
  } catch (err: any) {
    console.error('Failed to initTokenClient:', err);
    return false;
  }
};

/**
 * Synchronously triggers the GIS popup (MUST be called directly from user click)
 */
export const requestGISTokenSynchronously = (prompt: 'consent' | '' = 'consent') => {
  if (!getGoogleOAuthClientId()) {
    throw new Error('VITE_GOOGLE_OAUTH_CLIENT_ID belum dikonfigurasi. Gunakan opsi Token Manual atau atur Google OAuth Client ID di environment.');
  }
  if (!globalGISTokenClient) {
    throw new Error('Google Identity Services belum siap. Harap tunggu beberapa detik atau muat ulang halaman.');
  }
  globalGISTokenClient.requestAccessToken({ prompt });
};

/**
 * Returns a direct Google OAuth authorization URL that can be opened safely via an <a target="_blank"> link
 */
export const getDirectGoogleOAuthUrl = (): string => {
  const clientId = getGoogleOAuthClientId();
  if (!clientId) return '';
  const redirectUri = typeof window !== 'undefined' ? window.location.origin : '';
  const scopes = encodeURIComponent('https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file email profile openid');
  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${scopes}&prompt=consent`;
};

/**
 * Sign in using Google Identity Services (GIS) token client with Promise wrapper
 */
export const signInWithGoogleIdentityServices = (): Promise<{ user: any; accessToken: string }> => {
  return new Promise((resolve, reject) => {
    if (!getGoogleOAuthClientId()) {
      reject(new Error('VITE_GOOGLE_OAUTH_CLIENT_ID belum dikonfigurasi. Silakan gunakan Token Manual.'));
      return;
    }
    const success = initGISTokenClient(resolve, reject);
    if (!success) {
      reject(new Error('Google Identity Services belum dimuat. Silakan muat ulang halaman.'));
      return;
    }
    try {
      requestGISTokenSynchronously();
    } catch (e: any) {
      reject(e);
    }
  });
};

/**
 * Sign in using Google Identity Services (GIS) with basic non-sensitive scopes (email, profile, openid)
 */
export const signInWithGISBasic = (): Promise<{ user: any; accessToken: string }> => {
  return new Promise((resolve, reject) => {
    const google = (window as any).google;
    if (!google?.accounts?.oauth2) {
      reject(new Error('Google Identity Services belum siap. Harap tunggu beberapa detik atau muat ulang halaman.'));
      return;
    }
    const clientId = getGoogleOAuthClientId();
    if (!clientId) {
      reject(new Error('VITE_GOOGLE_OAUTH_CLIENT_ID tidak ditemukan dalam konfigurasi.'));
      return;
    }

    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'email profile openid',
        error_callback: (err: any) => {
          const msg = err?.message || err?.type || 'Jendela login diblokir oleh browser.';
          reject(new Error(
            msg === 'popup_failed_to_open'
              ? 'Browser memblokir pop-up. Harap izinkan pop-up untuk situs ini.'
              : `Gagal membuka jendela autentikasi: ${msg}`
          ));
        },
        callback: async (resp: any) => {
          if (resp.error) {
            reject(new Error(`Google OAuth error: ${resp.error_description || resp.error}`));
            return;
          }
          if (!resp.access_token) {
            reject(new Error('Tidak ada access token yang diterima dari Google.'));
            return;
          }
          const token = resp.access_token;
          try {
            const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (userRes.ok) {
              const profile = await userRes.json();
              resolve({
                user: {
                  displayName: profile.name || profile.email,
                  email: profile.email,
                  photoURL: profile.picture || '',
                  uid: profile.sub || 'google-user'
                },
                accessToken: token
              });
              return;
            }
          } catch (e) {
            console.warn('Could not fetch userinfo, resolving basic:', e);
          }
          resolve({
            user: { displayName: 'Pengguna Google', email: '', photoURL: '', uid: 'google-user' },
            accessToken: token
          });
        }
      });
      client.requestAccessToken({ prompt: 'select_account' });
    } catch (err: any) {
      reject(err);
    }
  });
};

/**
 * Sign in using pure Google Identity Services (GIS) OAuth for Google Sheets Sync.
 */
export const googleSignIn = async (): Promise<{ user: any; accessToken: string }> => {
  return signInWithGoogleIdentityServices();
};

/**
 * Set token manually for fallback environments
 */
export const setManualAccessToken = async (token: string): Promise<{ user: any; accessToken: string }> => {
  const cleanToken = token.trim();
  if (!cleanToken) throw new Error('Token tidak boleh kosong.');

  let userObj: any = {
    displayName: 'Pengguna Google (Manual Token)',
    email: 'Token terverifikasi',
    photoURL: '',
    uid: 'manual-token-user'
  };

  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${cleanToken}` }
    });
    if (res.ok) {
      const profile = await res.json();
      userObj = {
        displayName: profile.name || profile.email,
        email: profile.email,
        photoURL: profile.picture,
        uid: profile.sub || 'google-user'
      };
    }
  } catch (e) {
    console.warn('Could not fetch userinfo with manual token:', e);
  }

  cachedAccessToken = cleanToken;
  cachedGoogleUser = userObj;
  return { user: userObj, accessToken: cleanToken };
};

/**
 * Sign out from Google Sheets OAuth session and clear in-memory token
 */
export const googleSignOut = async (): Promise<void> => {
  try {
    const google = (window as any).google;
    if (cachedAccessToken && google?.accounts?.oauth2?.revoke) {
      google.accounts.oauth2.revoke(cachedAccessToken, () => {});
    }
  } catch {}
  cachedAccessToken = null;
  cachedGoogleUser = null;
};

/**
 * Retrieve active access token or null
 */
export const getAccessToken = (): string | null => {
  return cachedAccessToken;
};

/**
 * Get current Google authenticated user
 */
export const getCurrentGoogleUser = (): any => {
  return cachedGoogleUser;
};

/**
 * Extracts a Google Spreadsheet ID from either a full Google Sheets URL or a raw ID string
 */
export function extractSpreadsheetId(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed;
}

/**
 * Fetch metadata of a Google Spreadsheet (Title, Sheet tab names)
 */
export async function fetchSpreadsheetMeta(spreadsheetId: string): Promise<GoogleSpreadsheetMeta> {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Anda belum terautentikasi dengan akun Google. Silakan klik Masuk dengan Google.');
  }

  const cleanId = extractSpreadsheetId(spreadsheetId);
  if (!cleanId) {
    throw new Error('Spreadsheet ID atau URL tidak valid.');
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}?fields=properties.title,sheets.properties(sheetId,title)`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const message = errorData.error?.message || `Gagal mengakses spreadsheet (${res.status} ${res.statusText})`;
    if (res.status === 401) {
      cachedAccessToken = null;
      throw new Error('Sesi Google telah kedaluwarsa. Silakan masuk kembali dengan Google.');
    }
    if (res.status === 404) {
      throw new Error('Spreadsheet tidak ditemukan. Periksa kembali ID atau URL spreadsheet.');
    }
    if (res.status === 403) {
      throw new Error('Izin ditolak. Pastikan akun Google Anda memiliki akses ke spreadsheet tersebut.');
    }
    throw new Error(message);
  }

  const data = await res.json();
  const title = data.properties?.title || 'Spreadsheet Tanpa Judul';
  const sheets: string[] = (data.sheets || []).map((s: any) => s.properties?.title).filter(Boolean);

  return {
    id: cleanId,
    title,
    url: `https://docs.google.com/spreadsheets/d/${cleanId}/edit`,
    sheets: sheets.length > 0 ? sheets : ['Sheet1']
  };
}

/**
 * Automatically creates a new standardized MoraJaws Google Spreadsheet in the user's Google Drive
 */
export async function createDefaultMoraJawsSpreadsheet(customTitle?: string): Promise<GoogleSpreadsheetMeta> {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Anda belum terautentikasi dengan Google. Silakan login terlebih dahulu.');
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const title = customTitle?.trim() || `MoraJaws_WO_Master_Sync_${dateStr}`;

  const requestBody = {
    properties: {
      title
    },
    sheets: [
      {
        properties: {
          title: 'Work_Orders',
          gridProperties: {
            frozenRowCount: 1
          }
        },
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: [
              {
                values: STANDARD_SHEET_HEADERS.map(header => ({
                  userEnteredValue: { stringValue: header }
                }))
              }
            ]
          }
        ]
      }
    ]
  };

  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error?.message || 'Gagal membuat Google Spreadsheet baru.');
  }

  const data = await res.json();
  const createdId = data.spreadsheetId;

  return {
    id: createdId,
    title,
    url: `https://docs.google.com/spreadsheets/d/${createdId}/edit`,
    sheets: ['Work_Orders']
  };
}

/**
 * Convert a MoraJaws Ticket into a standardized array of cell values
 */
export function formatTicketToSheetRow(t: Ticket): (string | number)[] {
  return [
    t.woNumber || '',
    t.ticketNumber || '',
    t.date || '',
    t.appointmentDate || '',
    t.idCustomer || t.customerId || '',
    t.customerName || t.endUserName || '',
    t.customerPhone || '',
    t.customerContact2 || '',
    t.area || '',
    t.clusterName || '',
    t.streetName || '',
    t.streetAlternatif || '',
    t.contactorName || t.contractorName || (t as any).contractor || '',
    t.leaderName || t.corlapName || '',
    t.corlapContact || '',
    t.installerName || '',
    t.installerContact || '',
    t.slotTime || '',
    t.fdtCode || '',
    t.fatCode || '',
    t.fatPort || '',
    t.ticketCategory || '',
    t.statusWOAgent || '',
    t.statusWOInstaller || '',
    t.remarksWOInstaller || '',
    t.remarksAgent || '',
    t.technicalReport?.workResult || '',
    t.technicalReport?.rootCauseCategory || '',
    t.technicalReport?.rootCauseSubCategory || '',
    t.technicalReport?.opticalPowerRx || t.technicalReport?.opticalPowerDbm || '',
    t.ontSerialNumber || '',
    t.routerSerialNumber || '',
    t.dateAssignAgent || '',
    t.dateAssignTechnician || '',
    t.dateUpload || '',
    t.fileName || '',
    t.agentId || '',
    t.updatedAt || new Date().toISOString(),
    t.updatedBy || 'MoraJaws Sync'
  ];
}

/**
 * Pull all data rows from a Google Sheet tab and convert them to record objects
 */
export async function pullRowsFromSheet(
  spreadsheetId: string,
  sheetName: string = 'Work_Orders'
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Belum login dengan akun Google.');
  }

  const cleanId = extractSpreadsheetId(spreadsheetId);
  const range = `${encodeURIComponent(sheetName)}!A1:AZ2500`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${range}?valueRenderOption=FORMATTED_VALUE`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gagal membaca tab '${sheetName}' dari spreadsheet.`);
  }

  const data = await res.json();
  const rawValues: string[][] = data.values || [];

  if (rawValues.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = rawValues[0].map((h, i) => (h && h.trim()) ? h.trim() : `Column_${i + 1}`);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < rawValues.length; i++) {
    const row = rawValues[i];
    if (!row || row.every(c => !c || c.trim() === '')) continue;

    const rowObj: Record<string, string> = {};
    headers.forEach((h, colIndex) => {
      rowObj[h] = row[colIndex] !== undefined ? String(row[colIndex]).trim() : '';
    });
    rows.push(rowObj);
  }

  return { headers, rows };
}

/**
 * Push tickets to Google Sheet (overwrites data rows with updated state)
 */
export async function pushTicketsToSheet(
  spreadsheetId: string,
  sheetName: string = 'Work_Orders',
  tickets: Ticket[]
): Promise<{ updatedRows: number }> {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Belum login dengan akun Google.');
  }

  const cleanId = extractSpreadsheetId(spreadsheetId);
  const rows = tickets.map(formatTicketToSheetRow);
  const allValues = [STANDARD_SHEET_HEADERS, ...rows];

  const range = `${encodeURIComponent(sheetName)}!A1:AM${allValues.length}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${range}?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      range,
      majorDimension: 'ROWS',
      values: allValues
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Gagal menyimpan data ke Google Spreadsheet.');
  }

  return { updatedRows: rows.length };
}

/**
 * Append single new ticket or update a single row in Google Sheet
 */
export async function appendTicketToSheet(
  spreadsheetId: string,
  sheetName: string = 'Work_Orders',
  ticket: Ticket
): Promise<void> {
  const token = getAccessToken();
  if (!token) return;

  const cleanId = extractSpreadsheetId(spreadsheetId);
  const rowValues = formatTicketToSheetRow(ticket);
  const range = `${encodeURIComponent(sheetName)}!A:AM`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      range,
      majorDimension: 'ROWS',
      values: [rowValues]
    })
  });
}
