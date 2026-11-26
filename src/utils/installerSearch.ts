export interface SearchableInstallerOption {
  id: string;
  name: string;
  username?: string;
  assignedCount?: number;
  maxLimit?: number;
  isFull?: boolean;
  statusLabel?: string;
  area?: string;
  disabled?: boolean;
}

export function normalizeInstallerSearchQuery(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function filterInstallersByQuery<
  T extends {
    name?: string | null;
    username?: string | null;
  }
>(items: T[], rawQuery: string): T[] {
  const q = normalizeInstallerSearchQuery(rawQuery);
  if (!q) return items;

  return items.filter(item => {
    const normName = normalizeInstallerSearchQuery(String(item.name || ''));
    const normUsername = normalizeInstallerSearchQuery(String(item.username || ''));
    return normName.includes(q) || (Boolean(normUsername) && normUsername.includes(q));
  });
}

export function resolveSelectedInstallerOption<T extends SearchableInstallerOption>(
  options: T[],
  value: string,
  valueKey: 'id' | 'name' = 'name',
  fallbackCached?: T | null
): T | undefined {
  const cleanVal = String(value || '').trim();
  if (!cleanVal) return undefined;

  const normTarget = normalizeInstallerSearchQuery(cleanVal);
  const found = options.find(opt => {
    if (valueKey === 'id') {
      return String(opt.id || '').trim() === cleanVal;
    }
    return (
      normalizeInstallerSearchQuery(opt.name) === normTarget ||
      String(opt.id || '').trim() === cleanVal
    );
  });

  if (found) return found;

  if (fallbackCached) {
    const cachedMatches =
      valueKey === 'id'
        ? String(fallbackCached.id || '').trim() === cleanVal
        : normalizeInstallerSearchQuery(fallbackCached.name) === normTarget ||
          String(fallbackCached.id || '').trim() === cleanVal;
    if (cachedMatches) return fallbackCached;
  }

  return undefined;
}

export function formatInstallerCapacityLabel(opt: {
  name: string;
  assignedCount?: number;
  maxLimit?: number;
  isFull?: boolean;
  statusLabel?: string;
}): string {
  const hasCapacity = typeof opt.assignedCount === 'number' && typeof opt.maxLimit === 'number';
  if (!hasCapacity) return opt.name;
  const fullSuffix = opt.isFull ? ' - PENUH' : '';
  const statusSuffix = opt.statusLabel ? ` · ${opt.statusLabel}` : '';
  return `${opt.name} (${opt.assignedCount}/${opt.maxLimit}${statusSuffix})${fullSuffix}`;
}
