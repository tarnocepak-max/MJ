import React, { useState, useRef, useEffect } from 'react';
import { MoreVertical } from 'lucide-react';

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
  const containerRef = useRef<HTMLDivElement>(null);

  const visibleActions = actions.filter(a => !a.hidden);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

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
    <div ref={containerRef} className="relative inline-flex" onClick={e => e.stopPropagation()}>
      <button
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

      {open && (
        <div
          role="menu"
          className={`absolute top-full mt-1.5 z-50 min-w-[190px] max-w-[calc(100vw-2rem)] bg-white/95 dark:bg-[#1E1238] backdrop-blur-xl border border-[#DDE6F0] dark:border-[#4B386B] rounded-xl shadow-xl py-1.5 text-xs ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
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
        </div>
      )}
    </div>
  );
};
