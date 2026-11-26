import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeHotdeskModalViewportStyle,
  partitionSidebarNavigation,
  buildAppSettingCategories,
  mergeLeaderColumnsConfig,
  isAdminMenuId
} from '../src/utils/uiLayoutHelpers';

describe('uiLayoutHelpers', () => {
  it('computes fullscreen viewport styles when mobile keyboard is open', () => {
    const closed = computeHotdeskModalViewportStyle({
      viewportHeight: 900,
      viewportTop: 0,
      keyboardInset: 0,
      isKeyboardOpen: false
    });
    assert.deepEqual(closed, {
      backdropPaddingBottom: undefined,
      backdropPaddingTop: undefined,
      dialogHeight: undefined,
      dialogMaxHeight: undefined
    });

    const opened = computeHotdeskModalViewportStyle({
      viewportHeight: 480,
      viewportTop: 12,
      keyboardInset: 320,
      isKeyboardOpen: true
    });
    assert.deepEqual(opened, {
      backdropPaddingBottom: '320px',
      backdropPaddingTop: '12px',
      dialogHeight: '480px',
      dialogMaxHeight: '480px'
    });

    const tiny = computeHotdeskModalViewportStyle({
      viewportHeight: 200,
      viewportTop: 0,
      keyboardInset: 400,
      isKeyboardOpen: true
    });
    assert.equal(tiny.dialogHeight, '320px');
  });

  it('partitions Sidebar navigation cleanly between Operational Queue and Admin/App Setting', () => {
    const standalone = [
      { id: 'dashboard', label: 'Dashboard Monitoring' },
      { id: 'tickets', label: 'Ticket MyRepublic' },
      { id: 'users', label: 'Management User' }
    ];
    const categories = [
      {
        id: 'contractor_area',
        name: 'Contractor & Area',
        submenus: [
          { id: 'wo_assignment', label: 'Assign WO' },
          { id: 'quota_settings', label: 'Pengaturan Kuota & Kolom Visibilitas' }
        ]
      },
      {
        id: 'menu_tambahan',
        name: 'Menu Tambahan',
        submenus: [
          { id: 'setup', label: 'App Setting' },
          { id: 'database_management', label: 'Database Application' }
        ]
      }
    ];

    const result = partitionSidebarNavigation(standalone, categories);
    assert.deepEqual(
      result.operationalStandalone.map(m => m.id),
      ['dashboard', 'tickets']
    );
    assert.deepEqual(
      result.adminStandalone.map(m => m.id),
      ['users', 'quota_settings']
    );
    assert.equal(result.operationalCategories.length, 1);
    assert.deepEqual(
      result.operationalCategories[0].submenus.map(s => s.id),
      ['wo_assignment']
    );
    assert.equal(result.adminCategories.length, 1);
    assert.deepEqual(
      result.adminCategories.flatMap(c => c.submenus.map(s => s.id)),
      ['setup', 'database_management']
    );
    assert.equal(isAdminMenuId('tickets'), false);
    assert.equal(isAdminMenuId('setup'), true);
  });

  it('builds App Setting categories while omitting empty categories for Dispatch', () => {
    const categoriesDef = [
      { id: 'cat_general', code: '01', title: 'General & Application', tabKeys: ['app_config'] as const },
      { id: 'cat_ui', code: '02', title: 'Appearance & UI', tabKeys: ['ui_builder'] as const },
      { id: 'cat_nav', code: '03', title: 'Navigation', tabKeys: ['nav_config'] as const },
      {
        id: 'cat_ops',
        code: '04',
        title: 'Operational Configuration',
        tabKeys: ['droplists', 'whatsapp', 'workflows', 'sound'] as const
      },
      {
        id: 'cat_sys',
        code: '05',
        title: 'System Administration',
        tabKeys: ['users', 'roles', 'database', 'email_notifications', 'health_logs'] as const
      }
    ].map(c => ({ ...c, tabKeys: [...c.tabKeys] }));

    const dispatchTabs = [
      { key: 'droplists' },
      { key: 'whatsapp' },
      { key: 'workflows' },
      { key: 'sound' }
    ];

    const dispatchVisible = buildAppSettingCategories(dispatchTabs, categoriesDef);
    assert.equal(dispatchVisible.length, 1);
    assert.equal(dispatchVisible[0].title, 'Operational Configuration');
    assert.deepEqual(
      dispatchVisible[0].items.map(i => i.key),
      ['droplists', 'whatsapp', 'workflows', 'sound']
    );

    const superadminTabs = [
      { key: 'app_config' },
      { key: 'ui_builder' },
      { key: 'nav_config' },
      { key: 'droplists' },
      { key: 'whatsapp' },
      { key: 'workflows' },
      { key: 'sound' },
      { key: 'users' },
      { key: 'roles' },
      { key: 'database' },
      { key: 'email_notifications' },
      { key: 'health_logs' }
    ];
    const superadminVisible = buildAppSettingCategories(superadminTabs, categoriesDef);
    assert.equal(superadminVisible.length, 5);
  });

  it('merges Leader column configs and protects mandatory columns', () => {
    const defaults = [
      { id: 'woNumber', label: 'WO Number', visible: true, canHide: false },
      { id: 'customerName', label: 'Nama Pelanggan', visible: true, canHide: true },
      { id: 'area', label: 'Area', visible: true, canHide: true }
    ];

    const saved = [
      { id: 'area', label: 'Area', visible: false },
      { id: 'woNumber', label: 'WO Number', visible: false }, // locked -> stays visible
      { id: 'stale_col', label: 'Removed', visible: true }
    ];

    const merged = mergeLeaderColumnsConfig(saved, defaults);
    assert.deepEqual(
      merged.map(c => ({ id: c.id, visible: c.visible })),
      [
        { id: 'area', visible: false },
        { id: 'woNumber', visible: true },
        { id: 'customerName', visible: true }
      ]
    );
  });
});
