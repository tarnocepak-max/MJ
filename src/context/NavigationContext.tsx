import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  NavigationConfig,
  NavigationCategory,
  NavigationStandaloneMenu,
  NavigationSubmenuItem,
  AccordionSettings
} from '../types/navigation';
import { DEFAULT_NAVIGATION_CONFIG } from '../constants/defaultNavigationConfig';
import {
  loadNavigationConfigFromSupabase,
  normalizeNavigationConfig
} from '../services/navigationService';
import {
  getGlobalConfig,
  saveGlobalConfig,
  subscribeToGlobalConfigUpdates,
  ConfigConflictError,
  GlobalConfigConflictDetails,
  setTrackedConfigVersion
} from '../services/globalConfigService';
import { useToast } from './ToastContext';

const NAV_STORAGE_KEY = 'morajaws_navigation_config_v2';

interface NavigationContextType {
  navigationConfig: NavigationConfig;
  draftConfig: NavigationConfig;
  isDraftDirty: boolean;
  isSaving: boolean;
  isCloudSyncing: boolean;
  cloudSyncStatus: 'synced' | 'local_only' | 'syncing' | 'error';
  lastSyncTime: string | null;
  navVersion: number;
  navConflict: GlobalConfigConflictDetails | null;
  clearNavConflict: () => void;
  resolveNavConflict: (strategy: 'reload' | 'overwrite') => Promise<void>;

  // Accordion Expand/Collapse state
  expandedCategories: Record<string, boolean>;
  toggleCategory: (categoryId: string) => void;
  setCategoryExpanded: (categoryId: string, expanded: boolean) => void;

  // Draft Mutations
  updateCategoryInDraft: (id: string, updates: Partial<NavigationCategory>) => void;
  addCategoryToDraft: (name: string, icon?: string, mode?: 'accordion' | 'static') => { success: boolean; error?: string };
  deleteCategoryFromDraft: (id: string, actionForSubmenus?: 'move_to_tambahan' | 'disable') => void;
  moveCategoryInDraft: (id: string, direction: 'up' | 'down') => void;
  reorderCategoriesInDraft: (sourceIndex: number, destinationIndex: number) => void;

  updateStandaloneMenuInDraft: (id: string, updates: Partial<NavigationStandaloneMenu>) => void;
  moveStandaloneMenuInDraft: (id: string, direction: 'up' | 'down') => void;
  deleteStandaloneMenuFromDraft: (id: string) => void;
  reorderStandaloneMenusInDraft: (sourceIndex: number, destinationIndex: number) => void;

  updateSubmenuInDraft: (id: string, updates: Partial<NavigationSubmenuItem>) => void;
  addSubmenuToDraft: (name: string, categoryId: string, id: string, icon?: string) => { success: boolean; error?: string };
  deleteSubmenuFromDraft: (id: string) => void;
  moveSubmenuInDraft: (id: string, direction: 'up' | 'down') => void;
  moveSubmenuToCategoryInDraft: (submenuId: string, targetCategoryId: string) => void;
  reorderSubmenuInCategoryInDraft: (categoryId: string, sourceIndex: number, destinationIndex: number) => void;

  updateAccordionSettingsInDraft: (updates: Partial<AccordionSettings>) => void;

  // Global Actions
  saveChangesToSupabase: (
    operatorName?: string,
    options?: { forceOverwrite?: boolean }
  ) => Promise<{ success: boolean; error?: string; conflict?: GlobalConfigConflictDetails }>;
  cancelChanges: () => void;
  resetToDefaultConfig: (
    operatorName?: string,
    options?: { forceOverwrite?: boolean }
  ) => Promise<{ success: boolean; error?: string }>;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { toast } = useToast();

  // Primary active navigation config (stored locally & synced with Supabase PostgreSQL)
  const [navigationConfig, setNavigationConfig] = useState<NavigationConfig>(() => {
    try {
      const saved = localStorage.getItem(NAV_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return normalizeNavigationConfig(parsed);
      }
    } catch (e) {
      console.warn('[NavigationContext] Failed to parse local nav config, using default:', e);
    }
    return DEFAULT_NAVIGATION_CONFIG;
  });

  // Working draft for the admin Navigation Management view
  const [draftConfig, setDraftConfig] = useState<NavigationConfig>(navigationConfig);

  const [isSaving, setIsSaving] = useState(false);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'synced' | 'local_only' | 'syncing' | 'error'>('local_only');
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [navVersion, setNavVersion] = useState<number>(1);
  const navVersionRef = React.useRef<number>(1);
  const [navConflict, setNavConflict] = useState<GlobalConfigConflictDetails | null>(null);
  const pendingActionRef = React.useRef<{ type: 'save' | 'reset'; operatorName: string } | null>(null);

  // Accordion state: map of categoryId -> boolean (expanded / collapsed)
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const cat of navigationConfig.categories) {
      initial[cat.id] = true;
    }
    return initial;
  });

  // Keep draft in sync and ensure categories have expand entries
  useEffect(() => {
    setDraftConfig(navigationConfig);
    setExpandedCategories(prev => {
      const updated = { ...prev };
      for (const cat of navigationConfig.categories) {
        if (updated[cat.id] === undefined) {
          updated[cat.id] = true;
        }
      }
      return updated;
    });
  }, [navigationConfig]);

  // Persist to local storage whenever active config updates
  useEffect(() => {
    try {
      localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(navigationConfig));
    } catch (err) {
      console.error('[NavigationContext] Failed to persist to localStorage:', err);
    }
  }, [navigationConfig]);

  // Initial load from Supabase PostgreSQL and subscribe to real-time SSE updates (reacts to auth changes)
  useEffect(() => {
    let isMounted = true;
    let unsub: (() => void) | null = null;

    const hasSessionToken = () => {
      try {
        const raw = localStorage.getItem('morajaws_auth_session');
        const parsed = raw ? JSON.parse(raw) : null;
        return Boolean(parsed?.token);
      } catch {
        return false;
      }
    };

    async function initCloudNavigation() {
      if (unsub) {
        unsub();
        unsub = null;
      }

      if (!hasSessionToken()) {
        if (isMounted) setCloudSyncStatus('local_only');
        return;
      }

      setIsCloudSyncing(true);
      try {
        const cloudRes = await getGlobalConfig<NavigationConfig>('navigation_config').catch(() => null);
        const cloudVal = cloudRes?.value ?? (await loadNavigationConfigFromSupabase().catch(() => null));
        if (cloudVal && isMounted) {
          const normalized = normalizeNavigationConfig(cloudVal);
          setNavigationConfig(normalized);
          const ver = cloudRes?.version || normalized.navigationVersion || 1;
          navVersionRef.current = ver;
          setNavVersion(ver);
          setTrackedConfigVersion('navigation_config', ver);
          setLastSyncTime(cloudRes?.updatedAt || normalized.updatedAt);
          setCloudSyncStatus('synced');
        } else if (isMounted) {
          setCloudSyncStatus('local_only');
        }

        if (!isMounted) return;
        unsub = subscribeToGlobalConfigUpdates(
          (ev) => {
            if (!isMounted || ev.key !== 'navigation_config' || !ev.value) return;
            const normalized = normalizeNavigationConfig(ev.value);
            setNavigationConfig(normalized);
            if (typeof ev.version === 'number') {
              navVersionRef.current = ev.version;
              setNavVersion(ev.version);
              setTrackedConfigVersion('navigation_config', ev.version);
            }
            setLastSyncTime(ev.updatedAt || normalized.updatedAt);
            setCloudSyncStatus('synced');
          },
          (err) => {
            console.warn('[NavigationContext] Realtime listener error:', err);
            if (isMounted) setCloudSyncStatus('error');
          }
        );
      } catch (err) {
        console.warn('[NavigationContext] Initial cloud nav load failed:', err);
        if (isMounted) setCloudSyncStatus('error');
      } finally {
        if (isMounted) setIsCloudSyncing(false);
      }
    }

    void initCloudNavigation();

    const handleAuthChanged = () => {
      void initCloudNavigation();
    };
    window.addEventListener('morajaws:auth-changed', handleAuthChanged);

    return () => {
      isMounted = false;
      window.removeEventListener('morajaws:auth-changed', handleAuthChanged);
      if (unsub) unsub();
    };
  }, []);

  // Compute dirty flag
  const isDraftDirty = useMemo(() => {
    return JSON.stringify(draftConfig) !== JSON.stringify(navigationConfig);
  }, [draftConfig, navigationConfig]);

  // Accordion toggle handler
  const toggleCategory = useCallback((categoryId: string) => {
    setExpandedCategories(prev => {
      const isCurrentlyOpen = prev[categoryId] ?? true;
      const allowMultiple = navigationConfig.accordionSettings?.allowMultipleOpen ?? true;

      if (!allowMultiple) {
        // If single-accordion mode, close others when opening this one
        if (!isCurrentlyOpen) {
          return { [categoryId]: true };
        }
        return { ...prev, [categoryId]: false };
      }

      // Default: Independent multi-accordion
      return {
        ...prev,
        [categoryId]: !isCurrentlyOpen
      };
    });
  }, [navigationConfig.accordionSettings]);

  const setCategoryExpanded = useCallback((categoryId: string, expanded: boolean) => {
    setExpandedCategories(prev => ({
      ...prev,
      [categoryId]: expanded
    }));
  }, []);

  // ==========================================
  // DRAFT MUTATION METHODS
  // ==========================================

  // Category Draft Mutations
  const updateCategoryInDraft = useCallback((id: string, updates: Partial<NavigationCategory>) => {
    setDraftConfig(prev => ({
      ...prev,
      categories: prev.categories.map(cat => cat.id === id ? { ...cat, ...updates } : cat)
    }));
  }, []);

  const addCategoryToDraft = useCallback((name: string, icon?: string, mode: 'accordion' | 'static' = 'accordion') => {
    const trimmed = name.trim();
    if (!trimmed) {
      return { success: false, error: 'Nama kategori tidak boleh kosong.' };
    }
    const slug = 'cat_' + trimmed.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const existing = draftConfig.categories.find(c => c.id === slug || c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      return { success: false, error: 'Kategori dengan nama serupa sudah ada.' };
    }

    const nextOrder = draftConfig.categories.length > 0 
      ? Math.max(...draftConfig.categories.map(c => c.order)) + 1 
      : 1;

    const newCategory: NavigationCategory = {
      id: slug,
      name: trimmed,
      icon: icon || 'FolderTree',
      order: nextOrder,
      visible: true,
      mode,
      allowMultipleOpen: true
    };

    setDraftConfig(prev => ({
      ...prev,
      categories: [...prev.categories, newCategory]
    }));

    return { success: true };
  }, [draftConfig.categories]);

  const deleteCategoryFromDraft = useCallback((id: string, actionForSubmenus: 'move_to_tambahan' | 'disable' = 'move_to_tambahan') => {
    setDraftConfig(prev => {
      const remainingCats = prev.categories.filter(c => c.id !== id);
      const reorderedCats = remainingCats.map((c, idx) => ({ ...c, order: idx + 1 }));

      const updatedSubmenus = prev.submenuItems.map(item => {
        if (item.categoryId === id) {
          if (actionForSubmenus === 'move_to_tambahan') {
            return { ...item, categoryId: 'cat_tambahan' };
          } else {
            return { ...item, visible: false };
          }
        }
        return item;
      });

      return {
        ...prev,
        categories: reorderedCats,
        submenuItems: updatedSubmenus
      };
    });
  }, []);

  const moveCategoryInDraft = useCallback((id: string, direction: 'up' | 'down') => {
    setDraftConfig(prev => {
      const sorted = [...prev.categories].sort((a, b) => a.order - b.order);
      const index = sorted.findIndex(c => c.id === id);
      if (index === -1) return prev;
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= sorted.length) return prev;

      const temp = sorted[index];
      sorted[index] = sorted[targetIndex];
      sorted[targetIndex] = temp;

      const reordered = sorted.map((cat, idx) => ({ ...cat, order: idx + 1 }));
      return { ...prev, categories: reordered };
    });
  }, []);

  const reorderCategoriesInDraft = useCallback((sourceIndex: number, destinationIndex: number) => {
    setDraftConfig(prev => {
      const sorted = [...prev.categories].sort((a, b) => a.order - b.order);
      if (sourceIndex < 0 || sourceIndex >= sorted.length || destinationIndex < 0 || destinationIndex >= sorted.length) {
        return prev;
      }
      const [moved] = sorted.splice(sourceIndex, 1);
      sorted.splice(destinationIndex, 0, moved);
      const reordered = sorted.map((cat, idx) => ({ ...cat, order: idx + 1 }));
      return { ...prev, categories: reordered };
    });
  }, []);

  // Standalone Menu Draft Mutations
  const updateStandaloneMenuInDraft = useCallback((id: string, updates: Partial<NavigationStandaloneMenu>) => {
    setDraftConfig(prev => ({
      ...prev,
      standaloneMenus: prev.standaloneMenus.map(menu => menu.id === id ? { ...menu, ...updates } : menu)
    }));
  }, []);

  const moveStandaloneMenuInDraft = useCallback((id: string, direction: 'up' | 'down') => {
    setDraftConfig(prev => {
      const sorted = [...prev.standaloneMenus].sort((a, b) => a.order - b.order);
      const index = sorted.findIndex(m => m.id === id);
      if (index === -1) return prev;
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= sorted.length) return prev;

      const temp = sorted[index];
      sorted[index] = sorted[targetIndex];
      sorted[targetIndex] = temp;

      const reordered = sorted.map((m, idx) => ({ ...m, order: idx + 1 }));
      return { ...prev, standaloneMenus: reordered };
    });
  }, []);

  const deleteStandaloneMenuFromDraft = useCallback((id: string) => {
    // Instead of deleting code, mark as invisible or remove from config array
    setDraftConfig(prev => ({
      ...prev,
      standaloneMenus: prev.standaloneMenus.filter(m => m.id !== id)
    }));
  }, []);

  const reorderStandaloneMenusInDraft = useCallback((sourceIndex: number, destinationIndex: number) => {
    setDraftConfig(prev => {
      const sorted = [...prev.standaloneMenus].sort((a, b) => a.order - b.order);
      if (sourceIndex < 0 || sourceIndex >= sorted.length || destinationIndex < 0 || destinationIndex >= sorted.length) {
        return prev;
      }
      const [moved] = sorted.splice(sourceIndex, 1);
      sorted.splice(destinationIndex, 0, moved);
      const reordered = sorted.map((m, idx) => ({ ...m, order: idx + 1 }));
      return { ...prev, standaloneMenus: reordered };
    });
  }, []);

  // Submenu Draft Mutations
  const updateSubmenuInDraft = useCallback((id: string, updates: Partial<NavigationSubmenuItem>) => {
    setDraftConfig(prev => ({
      ...prev,
      submenuItems: prev.submenuItems.map(item => item.id === id ? { ...item, ...updates } : item)
    }));
  }, []);

  const addSubmenuToDraft = useCallback((name: string, categoryId: string, id: string, icon?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return { success: false, error: 'Nama submenu tidak boleh kosong.' };
    const cleanId = id.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!cleanId) return { success: false, error: 'ID submenu wajib diisi.' };

    const existing = draftConfig.submenuItems.find(s => s.id === cleanId);
    if (existing) return { success: false, error: 'ID submenu sudah digunakan.' };

    const catExists = draftConfig.categories.some(c => c.id === categoryId);
    if (!catExists) return { success: false, error: 'Kategori tujuan tidak valid.' };

    const categorySubmenus = draftConfig.submenuItems.filter(s => s.categoryId === categoryId);
    const nextOrder = categorySubmenus.length > 0 
      ? Math.max(...categorySubmenus.map(s => s.order)) + 1 
      : 1;

    const newSubmenu: NavigationSubmenuItem = {
      id: cleanId,
      name: trimmed,
      categoryId,
      icon: icon || 'FileSpreadsheet',
      order: nextOrder,
      visible: true
    };

    setDraftConfig(prev => ({
      ...prev,
      submenuItems: [...prev.submenuItems, newSubmenu]
    }));

    return { success: true };
  }, [draftConfig]);

  const deleteSubmenuFromDraft = useCallback((id: string) => {
    setDraftConfig(prev => ({
      ...prev,
      submenuItems: prev.submenuItems.filter(s => s.id !== id)
    }));
  }, []);

  const moveSubmenuInDraft = useCallback((id: string, direction: 'up' | 'down') => {
    setDraftConfig(prev => {
      const item = prev.submenuItems.find(s => s.id === id);
      if (!item) return prev;
      const inCategory = prev.submenuItems
        .filter(s => s.categoryId === item.categoryId)
        .sort((a, b) => a.order - b.order);

      const index = inCategory.findIndex(s => s.id === id);
      if (index === -1) return prev;
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= inCategory.length) return prev;

      const temp = inCategory[index];
      inCategory[index] = inCategory[targetIndex];
      inCategory[targetIndex] = temp;

      const reorderedInCategory = inCategory.map((s, idx) => ({ ...s, order: idx + 1 }));
      const otherSubmenus = prev.submenuItems.filter(s => s.categoryId !== item.categoryId);

      return {
        ...prev,
        submenuItems: [...otherSubmenus, ...reorderedInCategory]
      };
    });
  }, []);

  const moveSubmenuToCategoryInDraft = useCallback((submenuId: string, targetCategoryId: string) => {
    setDraftConfig(prev => {
      const targetSubmenus = prev.submenuItems.filter(s => s.categoryId === targetCategoryId);
      const nextOrder = targetSubmenus.length > 0 ? Math.max(...targetSubmenus.map(s => s.order)) + 1 : 1;

      return {
        ...prev,
        submenuItems: prev.submenuItems.map(s => {
          if (s.id === submenuId) {
            return { ...s, categoryId: targetCategoryId, order: nextOrder };
          }
          return s;
        })
      };
    });
  }, []);

  const reorderSubmenuInCategoryInDraft = useCallback((categoryId: string, sourceIndex: number, destinationIndex: number) => {
    setDraftConfig(prev => {
      const inCategory = prev.submenuItems
        .filter(s => s.categoryId === categoryId)
        .sort((a, b) => a.order - b.order);

      if (sourceIndex < 0 || sourceIndex >= inCategory.length || destinationIndex < 0 || destinationIndex >= inCategory.length) {
        return prev;
      }

      const [moved] = inCategory.splice(sourceIndex, 1);
      inCategory.splice(destinationIndex, 0, moved);

      const reorderedInCategory = inCategory.map((s, idx) => ({ ...s, order: idx + 1 }));
      const otherSubmenus = prev.submenuItems.filter(s => s.categoryId !== categoryId);

      return {
        ...prev,
        submenuItems: [...otherSubmenus, ...reorderedInCategory]
      };
    });
  }, []);

  const updateAccordionSettingsInDraft = useCallback((updates: Partial<AccordionSettings>) => {
    setDraftConfig(prev => ({
      ...prev,
      accordionSettings: {
        ...prev.accordionSettings,
        ...updates
      }
    }));
  }, []);

  // Save changes to Supabase PostgreSQL (Database-First with OCC conflict protection)
  const saveChangesToSupabase = useCallback(async (
    operatorName: string = 'Super Admin',
    options?: { forceOverwrite?: boolean }
  ): Promise<{ success: boolean; error?: string; conflict?: GlobalConfigConflictDetails }> => {
    setIsSaving(true);
    setCloudSyncStatus('syncing');

    // Validation before save
    if (draftConfig.categories.length === 0) {
      setIsSaving(false);
      setCloudSyncStatus('error');
      const err = 'Harus ada setidaknya 1 kategori navigasi.';
      toast.error(err, 'Validasi Gagal');
      return { success: false, error: err };
    }

    for (const cat of draftConfig.categories) {
      if (!cat.name.trim()) {
        setIsSaving(false);
        setCloudSyncStatus('error');
        const err = 'Nama kategori tidak boleh kosong.';
        toast.error(err, 'Validasi Gagal');
        return { success: false, error: err };
      }
    }

    for (const menu of draftConfig.standaloneMenus) {
      if (!menu.name.trim()) {
        setIsSaving(false);
        setCloudSyncStatus('error');
        const err = `Nama menu mandiri "${menu.id}" tidak boleh kosong.`;
        toast.error(err, 'Validasi Gagal');
        return { success: false, error: err };
      }
    }

    for (const sub of draftConfig.submenuItems) {
      if (!sub.name.trim()) {
        setIsSaving(false);
        setCloudSyncStatus('error');
        const err = `Nama submenu "${sub.id}" tidak boleh kosong.`;
        toast.error(err, 'Validasi Gagal');
        return { success: false, error: err };
      }
      const catExists = draftConfig.categories.some(c => c.id === sub.categoryId);
      if (!catExists) {
        setIsSaving(false);
        setCloudSyncStatus('error');
        const err = `Submenu "${sub.name}" memiliki parent category yang tidak valid.`;
        toast.error(err, 'Validasi Gagal');
        return { success: false, error: err };
      }
    }

    pendingActionRef.current = { type: 'save', operatorName };

    try {
      const payload: NavigationConfig = {
        ...draftConfig,
        navigationVersion: (navVersionRef.current || 1) + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: operatorName
      };
      const res = await saveGlobalConfig<NavigationConfig>('navigation_config', payload, {
        module: 'navigation_config',
        expectedVersion: navVersionRef.current,
        forceOverwrite: Boolean(options?.forceOverwrite),
        description: `MoraJaws navigation configuration updated by ${operatorName}`
      });

      const confirmed = normalizeNavigationConfig(res.value || payload);
      navVersionRef.current = res.version;
      setNavVersion(res.version);
      setNavigationConfig(confirmed);
      setLastSyncTime(res.updatedAt);
      setCloudSyncStatus('synced');
      setNavConflict(null);
      pendingActionRef.current = null;
      toast.success(
        `Konfigurasi navigasi v${res.version} berhasil disimpan permanen dan disinkronkan global.`,
        'Berhasil Menyimpan'
      );
      return { success: true };
    } catch (err: any) {
      console.error('[NavigationContext] Save to Supabase error:', err);
      setCloudSyncStatus('error');
      if (err instanceof ConfigConflictError) {
        setNavConflict(err.conflict);
        toast.warning(err.message, 'Konflik Versi Terdeteksi');
        return { success: false, error: err.message, conflict: err.conflict };
      }
      const errMsg = err?.message || 'Gagal menyimpan konfigurasi navigasi ke database.';
      toast.error(errMsg, 'Gagal Menyimpan');
      return { success: false, error: errMsg };
    } finally {
      setIsSaving(false);
    }
  }, [draftConfig, toast]);

  // Cancel changes: revert draft back to live navigationConfig
  const cancelChanges = useCallback(() => {
    setDraftConfig(navigationConfig);
    toast.info('Perubahan konfigurasi navigasi dibatalkan.', 'Dibatalkan');
  }, [navigationConfig, toast]);

  // Reset to default config
  const resetToDefaultConfig = useCallback(async (
    operatorName: string = 'Super Admin',
    options?: { forceOverwrite?: boolean }
  ): Promise<{ success: boolean; error?: string }> => {
    setIsSaving(true);
    setCloudSyncStatus('syncing');
    pendingActionRef.current = { type: 'reset', operatorName };
    try {
      const payload: NavigationConfig = {
        ...DEFAULT_NAVIGATION_CONFIG,
        navigationVersion: (navVersionRef.current || 1) + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: `${operatorName} (Reset Default)`
      };
      const res = await saveGlobalConfig<NavigationConfig>('navigation_config', payload, {
        module: 'navigation_config',
        expectedVersion: navVersionRef.current,
        forceOverwrite: Boolean(options?.forceOverwrite),
        description: `Navigation reset to default by ${operatorName}`
      });

      const confirmed = normalizeNavigationConfig(res.value || payload);
      navVersionRef.current = res.version;
      setNavVersion(res.version);
      setDraftConfig(confirmed);
      setNavigationConfig(confirmed);
      setLastSyncTime(res.updatedAt);
      setCloudSyncStatus('synced');
      setNavConflict(null);
      pendingActionRef.current = null;
      toast.success('Konfigurasi navigasi berhasil dikembalikan ke standar bawaan MoraJaws.', 'Reset Berhasil');
      return { success: true };
    } catch (err: any) {
      const errMsg = err?.message || 'Gagal mereset konfigurasi navigasi.';
      setCloudSyncStatus('error');
      if (err instanceof ConfigConflictError) {
        setNavConflict(err.conflict);
        toast.warning(err.message, 'Konflik Versi Terdeteksi');
        return { success: false, error: errMsg };
      }
      toast.error(errMsg, 'Reset Gagal');
      return { success: false, error: errMsg };
    } finally {
      setIsSaving(false);
    }
  }, [toast]);

  const clearNavConflict = useCallback(() => {
    setNavConflict(null);
    pendingActionRef.current = null;
  }, []);

  const resolveNavConflict = useCallback(async (strategy: 'reload' | 'overwrite') => {
    if (strategy === 'reload') {
      try {
        const res = await getGlobalConfig<NavigationConfig>('navigation_config');
        if (res.value) {
          const normalized = normalizeNavigationConfig(res.value);
          setNavigationConfig(normalized);
          setDraftConfig(normalized);
          navVersionRef.current = res.version || 1;
          setNavVersion(res.version || 1);
          setLastSyncTime(res.updatedAt || normalized.updatedAt);
          setCloudSyncStatus('synced');
          toast.info(`Konfigurasi navigasi terbaru (v${res.version}) dimuat dari database.`, 'Versi Terbaru Dimuat');
        }
      } catch (err: any) {
        toast.error(err?.message || 'Gagal memuat versi terbaru dari database.');
      } finally {
        setNavConflict(null);
        pendingActionRef.current = null;
      }
      return;
    }

    const pending = pendingActionRef.current;
    if (pending?.type === 'reset') {
      await resetToDefaultConfig(pending.operatorName, { forceOverwrite: true });
    } else {
      await saveChangesToSupabase(pending?.operatorName || 'Super Admin', { forceOverwrite: true });
    }
  }, [resetToDefaultConfig, saveChangesToSupabase, toast]);

  return (
    <NavigationContext.Provider
      value={{
        navigationConfig,
        draftConfig,
        isDraftDirty,
        isSaving,
        isCloudSyncing,
        cloudSyncStatus,
        lastSyncTime,
        navVersion,
        navConflict,
        clearNavConflict,
        resolveNavConflict,

        expandedCategories,
        toggleCategory,
        setCategoryExpanded,

        updateCategoryInDraft,
        addCategoryToDraft,
        deleteCategoryFromDraft,
        moveCategoryInDraft,
        reorderCategoriesInDraft,

        updateStandaloneMenuInDraft,
        moveStandaloneMenuInDraft,
        deleteStandaloneMenuFromDraft,
        reorderStandaloneMenusInDraft,

        updateSubmenuInDraft,
        addSubmenuToDraft,
        deleteSubmenuFromDraft,
        moveSubmenuInDraft,
        moveSubmenuToCategoryInDraft,
        reorderSubmenuInCategoryInDraft,

        updateAccordionSettingsInDraft,

        saveChangesToSupabase,
        cancelChanges,
        resetToDefaultConfig
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
};

export const useNavigation = () => {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
};
