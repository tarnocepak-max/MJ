export interface HotdeskViewportMetrics {
  viewportHeight: number;
  viewportTop: number;
  keyboardInset: number;
  isKeyboardOpen: boolean;
}

export interface HotdeskFullscreenStyles {
  backdropPaddingBottom?: string;
  backdropPaddingTop?: string;
  dialogHeight?: string;
  dialogMaxHeight?: string;
}

/**
 * Computes fullscreen sizing styles for Dispatch Hotdesk QC Modal so that
 * desktop and mobile occupy the full viewport while keeping header and action
 * footer reachable when an Android/iOS soft keyboard reduces visualViewport.
 */
export function computeHotdeskModalViewportStyle(
  metrics: HotdeskViewportMetrics
): HotdeskFullscreenStyles {
  const height = Number(metrics.viewportHeight || 0);
  const top = Math.max(0, Number(metrics.viewportTop || 0));
  const keyboardInset = Math.max(0, Number(metrics.keyboardInset || 0));

  if (metrics.isKeyboardOpen && height > 0) {
    const safeH = `${Math.max(320, Math.round(height))}px`;
    return {
      backdropPaddingBottom: keyboardInset > 0 ? `${Math.round(keyboardInset)}px` : undefined,
      backdropPaddingTop: top > 0 ? `${Math.round(top)}px` : undefined,
      dialogHeight: safeH,
      dialogMaxHeight: safeH
    };
  }

  return {
    backdropPaddingBottom: undefined,
    backdropPaddingTop: undefined,
    dialogHeight: undefined,
    dialogMaxHeight: undefined
  };
}

export interface SidebarMenuBase {
  id: string;
  label: string;
  order?: number;
  icon?: string;
  badge?: string | number;
  visible?: boolean;
  highlight?: boolean;
  roles?: string[];
}

export interface SidebarCategoryBase<TSub extends SidebarMenuBase = SidebarMenuBase> {
  id: string;
  name: string;
  icon?: string;
  order?: number;
  isActive?: boolean;
  mode?: 'accordion' | 'static';
  submenus: TSub[];
}

export interface PartitionedSidebarMenus<
  TStandalone extends SidebarMenuBase = SidebarMenuBase,
  TCategory extends SidebarCategoryBase = SidebarCategoryBase
> {
  operationalStandalone: TStandalone[];
  operationalCategories: TCategory[];
  adminStandalone: TStandalone[];
  adminCategories: TCategory[];
}

const ADMIN_STANDALONE_IDS = new Set([
  'users',
  'setup',
  'nav_config',
  'management_role',
  'droplist_management',
  'templates',
  'sound_settings',
  'audit_logs',
  'login_logs',
  'system_health',
  'offline_sync',
  'database_management',
  'data_deletion',
  'settings',
  'ui_builder',
  'workflows',
  'quota_settings'
]);

const ADMIN_CATEGORY_IDS = new Set([
  'menu_tambahan',
  'cat_tambahan',
  'app_setting',
  'administration',
  'system_admin'
]);

const ADMIN_SUBMENU_IDS = new Set([
  'setup',
  'nav_config',
  'management_role',
  'droplist_management',
  'templates',
  'sound_settings',
  'audit_logs',
  'login_logs',
  'system_health',
  'offline_sync',
  'database_management',
  'data_deletion',
  'users',
  'quota_settings',
  'ui_builder',
  'workflows',
  'settings'
]);

export function isAdminMenuId(menuId?: string): boolean {
  const normalized = String(menuId || '').trim().toLowerCase();
  return ADMIN_STANDALONE_IDS.has(normalized) || ADMIN_SUBMENU_IDS.has(normalized);
}

/**
 * Separates Sidebar items into Operational Queue items vs Administration / App Setting items
 * without altering underlying RBAC-filtered items.
 */
export function partitionSidebarNavigation<
  TStandalone extends SidebarMenuBase,
  TCategory extends SidebarCategoryBase
>(
  standaloneMenus: TStandalone[],
  categoriesWithSubmenus: TCategory[]
): PartitionedSidebarMenus<TStandalone, TCategory> {
  const operationalStandalone: TStandalone[] = [];
  const adminStandalone: TStandalone[] = [];

  for (const item of standaloneMenus || []) {
    if (!item || !item.id) continue;
    if (isAdminMenuId(item.id)) {
      adminStandalone.push(item);
    } else {
      operationalStandalone.push(item);
    }
  }

  const operationalCategories: TCategory[] = [];
  const adminCategories: TCategory[] = [];

  for (const cat of categoriesWithSubmenus || []) {
    if (!cat || !Array.isArray(cat.submenus) || cat.submenus.length === 0) continue;
    const catId = String(cat.id || '').trim().toLowerCase();
    const isWholeAdminCategory = ADMIN_CATEGORY_IDS.has(catId);

    if (isWholeAdminCategory) {
      adminCategories.push(cat);
      continue;
    }

    const opSubs = cat.submenus.filter(sub => !isAdminMenuId(sub.id));
    const admSubs = cat.submenus.filter(sub => isAdminMenuId(sub.id));

    if (opSubs.length > 0) {
      operationalCategories.push({ ...cat, submenus: opSubs });
    }
    if (admSubs.length > 0) {
      for (const sub of admSubs) {
        if (!adminStandalone.some(existing => existing.id === sub.id)) {
          adminStandalone.push(sub as unknown as TStandalone);
        }
      }
    }
  }

  return {
    operationalStandalone,
    operationalCategories,
    adminStandalone,
    adminCategories
  };
}

export interface AppSettingCategoryInput<K extends string = string> {
  id: string;
  code: string;
  title: string;
  tabKeys: K[];
}

export interface AppSettingTabBase<K extends string = string> {
  key: K;
}

export function buildAppSettingCategories<
  K extends string,
  TTab extends AppSettingTabBase<K>,
  TCat extends AppSettingCategoryInput<K>
>(
  accessibleTabs: TTab[],
  categoriesDef: TCat[]
): Array<TCat & { items: TTab[] }> {
  return (categoriesDef || [])
    .map(cat => ({
      ...cat,
      items: cat.tabKeys
        .map(k => accessibleTabs.find(t => t.key === k))
        .filter((t): t is TTab => Boolean(t))
    }))
    .filter(cat => cat.items.length > 0);
}

export interface LeaderColumnConfigShape {
  id: string;
  label: string;
  visible: boolean;
  canHide?: boolean;
}

/**
 * Merges saved Leader column preferences with DEFAULT_LEADER_COLUMNS,
 * preserving user ordering/visibility and enforcing mandatory columns.
 */
export function mergeLeaderColumnsConfig<T extends LeaderColumnConfigShape>(
  savedCols: unknown,
  defaultCols: T[]
): T[] {
  if (!Array.isArray(savedCols) || savedCols.length === 0) {
    return defaultCols.map(col => ({ ...col }));
  }

  const orderedCols: T[] = [];
  const seen = new Set<string>();

  for (const item of savedCols) {
    if (!item || typeof item !== 'object') continue;
    const id = String((item as LeaderColumnConfigShape).id || '');
    if (!id || seen.has(id)) continue;
    const def = defaultCols.find(d => d.id === id);
    if (!def) continue;
    seen.add(id);
    const isLocked = def.canHide === false;
    orderedCols.push({
      ...def,
      visible: isLocked ? true : Boolean((item as LeaderColumnConfigShape).visible)
    });
  }

  for (const def of defaultCols) {
    if (!seen.has(def.id)) {
      orderedCols.push({ ...def });
    }
  }

  return orderedCols;
}

const FORBIDDEN_OPERATIONAL_ACTION_PATTERN =
  /(^|[-_.\s])(delete|hapus|soft_delete|hard_delete|purge|archive|arsip)([-_.\s]|$)/i;

export function isForbiddenOperationalQueueActionId(actionId?: string): boolean {
  const normalized = String(actionId || '').trim();
  if (!normalized) return false;
  return FORBIDDEN_OPERATIONAL_ACTION_PATTERN.test(normalized);
}

/**
 * Ensures Delete WO / Archive WO actions are never rendered inside Operational Queue
 * menus while leaving dedicated admin portals & backend services untouched.
 */
export function sanitizeOperationalQueueActions<T extends { id: string; hidden?: boolean }>(
  actions: T[]
): T[] {
  return (actions || []).filter(
    item => item && !item.hidden && !isForbiddenOperationalQueueActionId(item.id)
  );
}

export interface DropdownMenuRectInput {
  triggerTop: number;
  triggerBottom: number;
  triggerLeft: number;
  triggerRight: number;
  viewportWidth: number;
  viewportHeight: number;
  menuWidth: number;
  menuHeight: number;
  align?: 'left' | 'right';
  bottomNavSafeInset?: number;
}

export function computeDropdownMenuPosition(input: DropdownMenuRectInput): {
  top: number;
  left: number;
  maxHeight: number;
} {
  const vw = Math.max(240, Number(input.viewportWidth || 1024));
  const vh = Math.max(280, Number(input.viewportHeight || 768));
  const menuW = Math.min(Number(input.menuWidth || 220), vw - 16);
  const bottomInset =
    typeof input.bottomNavSafeInset === 'number'
      ? Math.max(8, input.bottomNavSafeInset)
      : vw < 768
      ? 84
      : 12;
  const usableBottom = vh - bottomInset;
  const maxHeight = Math.max(160, usableBottom - 16);
  const menuH = Math.min(Math.max(48, Number(input.menuHeight || 160)), maxHeight);

  let left = input.align === 'left' ? input.triggerLeft : input.triggerRight - menuW;
  if (left + menuW > vw - 8) left = vw - menuW - 8;
  if (left < 8) left = 8;

  let top = input.triggerBottom + 6;
  const spaceBelow = usableBottom - top;
  const spaceAbove = input.triggerTop - 14;
  if (spaceBelow < menuH && spaceAbove > spaceBelow) {
    top = input.triggerTop - menuH - 6;
  }
  top = Math.max(8, Math.min(top, Math.max(8, usableBottom - menuH)));

  return {
    top: Math.round(top),
    left: Math.round(left),
    maxHeight: Math.round(maxHeight)
  };
}

export interface AndroidCardConfigInput {
  layoutType?: string;
  touchTargetSize?: string;
  cardDensity?: string;
  showQuickCall?: boolean;
  showQuickWhatsApp?: boolean;
  showQuickDetail?: boolean;
  highContrastBadges?: boolean;
}

export interface NormalizedAndroidCardConfig {
  layoutType: 'cards' | 'compact_list';
  touchTargetSize: 'standard' | 'comfortable';
  cardDensity: 'compact' | 'comfortable' | 'spacious';
  showQuickCall: boolean;
  showQuickWhatsApp: boolean;
  showQuickDetail: boolean;
  highContrastBadges: boolean;
}

export function normalizeAndroidCardSettings(
  raw?: AndroidCardConfigInput | null
): NormalizedAndroidCardConfig {
  const cfg = raw || {};
  return {
    layoutType: cfg.layoutType === 'compact_list' ? 'compact_list' : 'cards',
    touchTargetSize: cfg.touchTargetSize === 'standard' ? 'standard' : 'comfortable',
    cardDensity:
      cfg.cardDensity === 'compact' || cfg.cardDensity === 'spacious'
        ? cfg.cardDensity
        : 'comfortable',
    showQuickCall: cfg.showQuickCall !== false,
    showQuickWhatsApp: cfg.showQuickWhatsApp !== false,
    showQuickDetail: cfg.showQuickDetail !== false,
    highContrastBadges: cfg.highContrastBadges !== false
  };
}

