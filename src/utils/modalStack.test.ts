import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerModalLayer,
  getOpenModalCount,
  shouldHideBottomNavigation,
  getLayerZIndex,
  getDynamicPopoverZIndex,
  __resetModalStackForTests
} from './modalStack';

test('modalStack registers, stacks, and cleans up layers accurately', () => {
  __resetModalStackForTests();

  assert.equal(getOpenModalCount(), 0);
  assert.equal(shouldHideBottomNavigation(), false);
  assert.equal(getDynamicPopoverZIndex(), 55);

  const unregisterModal1 = registerModalLayer('modal-1', { tier: 'modal' });
  assert.equal(getOpenModalCount(), 1);
  assert.equal(shouldHideBottomNavigation(), true);
  assert.equal(getLayerZIndex('modal-1', 'modal'), 70);
  assert.ok(getDynamicPopoverZIndex() >= 120);

  const unregisterNested = registerModalLayer('lightbox-1', { tier: 'nested' });
  const unregisterConfirm = registerModalLayer('confirm-1', { tier: 'confirm' });

  assert.equal(getOpenModalCount(), 3);
  assert.ok(getLayerZIndex('lightbox-1', 'nested') > getLayerZIndex('modal-1', 'modal'));
  assert.ok(getLayerZIndex('confirm-1', 'confirm') > getLayerZIndex('lightbox-1', 'nested'));
  assert.ok(getDynamicPopoverZIndex() > getLayerZIndex('confirm-1', 'confirm'));

  // Closing one modal keeps bottom nav hidden until all hiding modals close
  unregisterConfirm();
  assert.equal(getOpenModalCount(), 2);
  assert.equal(shouldHideBottomNavigation(), true);

  unregisterNested();
  unregisterModal1();
  assert.equal(getOpenModalCount(), 0);
  assert.equal(shouldHideBottomNavigation(), false);
  assert.equal(getDynamicPopoverZIndex(), 55);
});

test('modalStack handles repeated open/close and hidesBottomNav=false properly', () => {
  __resetModalStackForTests();

  const u1 = registerModalLayer('drawer-soft', { tier: 'drawer', hidesBottomNav: false });
  assert.equal(getOpenModalCount(), 1);
  assert.equal(shouldHideBottomNavigation(), false);

  const u2 = registerModalLayer('modal-main', { tier: 'modal', hidesBottomNav: true });
  assert.equal(shouldHideBottomNavigation(), true);

  // Double-cleanup should be safe & idempotent
  u2();
  u2();
  assert.equal(shouldHideBottomNavigation(), false);

  u1();
  assert.equal(getOpenModalCount(), 0);
});
