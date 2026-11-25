import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import { useModalPopoverZIndex } from '../../hooks/useModalLayer';

export interface DropdownActionItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  disabled?: boolean;
  hidden?: boolean;
  dividerBefore?: boolean;
}

export interface ActionDropdownMenuProps {
  actions: DropdownActionItem[];
  triggerLabel?: string;
  align?: 'left' | 'right';
  size?: 'sm' | 'md';
  triggerClassName?: string;
}

export const ActionDropdownMenu: React.FC<ActionDropdownMenuProps> = ({
  actions,
  triggerLabel = 'Menu Aksi',
  align = 'right',
  size = 'md',
  triggerClassName = ''
}) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const zIndex = useModalPopoverZIndex();

  const visibleActions = actions.filter(a => !a.hidden);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === 'undefined') return;
    const rect = trigger.getBoundingClientRect();
    const vv = window.visualViewport;
    const vw = vv?.width ?? window.innerWidth;
    const vh = vv?.height ?? window.innerHeight;
    const menuWidth = Math.min(220, vw - 16);
    const estHeight = Math.min(280, visibleActions.length * 40 + 16);

    let left = align === 'right' ? rect.right - menuWidth : rect.left;
    if (left + menuWidth > vw - 8) left = vw - menuWidth - 8;
    if (left < 8) left = 8;

    let top = rect.bottom + 6;
    if (top + estHeight > vh - 10 && rect.top - estHeight - 6 > 8) {
      top = rect.top - estHeight - 6;
    }
    top = Math.max(8, Math.min(top, vh - estHeight - 8));

    setCoords({ top, left });
  }, [align, visibleActions.length]);

  useEffect(() => {
    if (!open) return;
    updatePosition();

    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const handleReposition = () => updatePosition();

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    window.visualViewport?.addEventListener('resize', handleReposition);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
      window.visualViewport?.removeEventListener('resize', handleReposition);
    };
  }, [open, updatePosition]);

  if (visibleActions.length === 0) return null;

  const toneClasses = (tone: DropdownActionItem['tone']) => {
    switch (tone) {
      case 'danger':
        return 'text-[#D45B66] dark:text-rose-300 hover:bg-[#FCE9EB] dark:hover:bg-rose-950/60';
      case 'success':
        return 'text-[#218A63] dark:text-emerald-300 hover:bg-[#E4F5EC] dark:hover:bg-emerald-950/60';
      case 'warning':
        return 'text-[#C88735] dark:text-amber-300 hover:bg-[#FFF2D9] dark:hover:bg-amber-950/60';
      case 'primary':
        return 'text-[#5145A6] dark:text-[#DAB9FF] hover:bg-[#F0EDFF] dark:hover:bg-[#35105E]';
      default:
        return 'text-[#26364A] dark:text-[#F5EEFF] hover:bg-[#F8FAFD] dark:hover:bg-[#35105E]/70';
    }
  };

  return (
    <div className="relative inline-flex" onClick={e => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(prev => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
        className={`btn-3d-icon cursor-pointer ${
          size === 'sm' ? 'w-9 h-9' : 'min-w-[40px] min-h-[40px] sm:min-w-[36px] sm:min-h-[36px]'
        } ${triggerClassName}`}
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ top: coords.top, left: coords.left, zIndex }}
            onClick={e => e.stopPropagation()}
            className="fixed min-w-[200px] max-w-[calc(100vw-1rem)] bg-white/96 dark:bg-[#1E1238] backdrop-blur-xl border border-[#DDE6F0] dark:border-[#4B386B] rounded-xl shadow-xl py-1.5 text-xs"
          >
            {visibleActions.map(action => (
              <React.Fragment key={action.id}>
                {action.dividerBefore && (
                  <div className="my-1 border-t border-[#DDE6F0] dark:border-[#35105E]" />
                )}
                <button
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  onClick={() => {
                    if (action.disabled) return;
                    setOpen(false);
                    action.onClick();
                  }}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 sm:py-2 text-left font-semibold transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${toneClasses(
                    action.tone
                  )}`}
                >
                  {action.icon && <span className="shrink-0">{action.icon}</span>}
                  <span className="truncate">{action.label}</span>
                </button>
              </React.Fragment>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
};
