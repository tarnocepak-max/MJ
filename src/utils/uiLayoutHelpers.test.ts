import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeHotdeskModalViewportStyle,
  partitionSidebarNavigation,
  buildAppSettingCategories,
  mergeLeaderColumnsConfig,
  isForbiddenOperationalQueueActionId,
  sanitizeOperationalQueueActions,
  computeDropdownMenuPosition,
  normalizeAndroidCardSettings
} from './uiLayoutHelpers';

test('computeHotdeskModalViewportStyle adapts height and insets when soft keyboard opens', () => {
  const closed = computeHotdeskModalViewportStyle({
    viewportHeight: 844,
    viewportTop: 0,
    keyboardInset: 0,
    isKeyboardOpen: false
  });
  assert.equal(closed.dialogHeight, undefined);
  assert.equal(closed.backdropPaddingBottom, undefined);

  const open = computeHotdeskModalViewportStyle({
    viewportHeight: 510,
    viewportTop: 12,
    keyboardInset: 334,
    isKeyboardOpen: true
  });
  assert.equal(open.dialogHeight, '510px');
  assert.equal(open.dialogMaxHeight, '510px');
  assert.equal(open.backdropPaddingBottom, '334px');
  assert.equal(open.backdropPaddingTop, '12px');
});

test('sanitizeOperationalQueueActions excludes Delete/Archive actions while preserving operational actions', () => {
  assert.equal(isForbiddenOperationalQueueActionId('delete_wo'), true);
  assert.equal(isForbiddenOperationalQueueActionId('hapus_tiket'), true);
  assert.equal(isForbiddenOperationalQueueActionId('archive_ticket'), true);
  assert.equal(isForbiddenOperationalQueueActionId('detail_wo'), false);
  assert.equal(isForbiddenOperationalQueueActionId('dispatch_review'), false);

  const input = [
    { id: 'detail_wo', label: 'Buka Detail WO' },
    { id: 'dispatch_review', label: 'Dispatch Review' },
    { id: 'approve_wo', label: 'Approve' },
    { id: 'reassign', label: 'Reassign Teknisi' },
    { id: 'chat', label: 'Buka LiveChat' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'maps', label: 'Google Maps' },
    { id: 'copy_wo', label: 'Salin No. WO' },
    { id: 'delete_wo', label: 'Hapus WO' },
    { id: 'archive_wo', label: 'Arsipkan WO' },
    { id: 'hidden_btn', label: 'Hidden', hidden: true }
  ];

  const output = sanitizeOperationalQueueActions(input);
  assert.deepEqual(
    output.map(a => a.id),
    ['detail_wo', 'dispatch_review', 'approve_wo', 'reassign', 'chat', 'whatsapp', 'maps', 'copy_wo']
  );
});

test('computeDropdownMenuPosition flips upward near bottom and respects 84px mobile bottom nav inset', () => {
  const desktopNearTop = computeDropdownMenuPosition({
    triggerTop: 120,
    triggerBottom: 152,
    triggerLeft: 1200,
    triggerRight: 1232,
    viewportWidth: 1440,
    viewportHeight: 900,
    menuWidth: 224,
    menuHeight: 260
  });
  assert.equal(desktopNearTop.top, 158);
  assert.equal(desktopNearTop.left, 1008);

  const mobileNearBottomNav = computeDropdownMenuPosition({
    triggerTop: 720,
    triggerBottom: 752,
    triggerLeft: 330,
    triggerRight: 366,
    viewportWidth: 390,
    viewportHeight: 844,
    menuWidth: 224,
    menuHeight: 240
  });
  // Usable bottom is 844 - 84 = 760, so menu flips upward above triggerTop (720 - 240 - 6 = 474)
  assert.equal(mobileNearBottomNav.top, 474);
  assert.ok(mobileNearBottomNav.top + 240 <= 760);
  assert.ok(mobileNearBottomNav.left >= 8 && mobileNearBottomNav.left + 224 <= 382);
});

test('normalizeAndroidCardSettings maps quick actions and card density defaults cleanly', () => {
  const defaults = normalizeAndroidCardSettings(null);
  assert.equal(defaults.layoutType, 'cards');
  assert.equal(defaults.touchTargetSize, 'comfortable');
  assert.equal(defaults.cardDensity, 'comfortable');
  assert.equal(defaults.showQuickCall, true);
  assert.equal(defaults.showQuickWhatsApp, true);
  assert.equal(defaults.showQuickDetail, true);
  assert.equal(defaults.highContrastBadges, true);

  const customized = normalizeAndroidCardSettings({
    layoutType: 'compact_list',
    touchTargetSize: 'standard',
    cardDensity: 'compact',
    showQuickCall: false,
    showQuickWhatsApp: false,
    showQuickDetail: false,
    highContrastBadges: false
  });
  assert.equal(customized.layoutType, 'compact_list');
  assert.equal(customized.touchTargetSize, 'standard');
  assert.equal(customized.cardDensity, 'compact');
  assert.equal(customized.showQuickCall, false);
  assert.equal(customized.showQuickWhatsApp, false);
  assert.equal(customized.showQuickDetail, false);
  assert.equal(customized.highContrastBadges, false);
});

test('mergeLeaderColumnsConfig enforces mandatory columns and preserves custom ordering', () => {
  const defaults = [
    { id: 'wo', label: 'No. WO', visible: true, canHide: false },
    { id: 'customer', label: 'Pelanggan', visible: true, canHide: true },
    { id: 'action', label: 'ACTION', visible: true, canHide: false }
  ];
  const saved = [
    { id: 'action', label: 'ACTION', visible: false },
    { id: 'customer', label: 'Pelanggan', visible: false }
  ];
  const merged = mergeLeaderColumnsConfig(saved, defaults);
  assert.deepEqual(
    merged.map(c => ({ id: c.id, visible: c.visible })),
    [
      { id: 'action', visible: true },
      { id: 'customer', visible: false },
      { id: 'wo', visible: true }
    ]
  );
});

test('partitionSidebarNavigation separates operational and admin menus and buildAppSettingCategories drops empty categories', () => {
  const partitioned = partitionSidebarNavigation(
    [
      { id: 'tickets', label: 'Work Order' },
      { id: 'setup', label: 'App Setting' }
    ],
    [
      {
        id: 'app_setting',
        name: 'App Setting',
        submenus: [{ id: 'users', label: 'Users' }]
      },
      {
        id: 'ops',
        name: 'Operations',
        submenus: [{ id: 'sameday', label: 'Same Day' }]
      }
    ]
  );

  assert.equal(partitioned.operationalStandalone.map(i => i.id).join(','), 'tickets');
  assert.equal(partitioned.adminStandalone.map(i => i.id).join(','), 'setup');
  assert.equal(partitioned.operationalCategories.map(c => c.id).join(','), 'ops');
  assert.equal(partitioned.adminCategories.map(c => c.id).join(','), 'app_setting');

  const cats = buildAppSettingCategories(
    [{ key: 'app_config' }, { key: 'ui_builder' }],
    [
      { id: 'c1', code: '01', title: 'General', tabKeys: ['app_config'] },
      { id: 'c2', code: '02', title: 'Empty', tabKeys: ['workflows'] },
      { id: 'c3', code: '03', title: 'Appearance', tabKeys: ['ui_builder'] }
    ]
  );
  assert.deepEqual(
    cats.map(c => c.id),
    ['c1', 'c3']
  );
});
