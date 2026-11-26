import React from 'react';
import { MapPin, Compass } from 'lucide-react';
import { Ticket } from '../../types/index.ts';
import { AddressInput, formatWorkOrderAddress } from '../../utils/addressFormatter.ts';

export type WorkOrderAddressVariant = 'card' | 'detail' | 'banner' | 'camera' | 'whatsapp';

export interface WorkOrderAddressBlockProps {
  ticket?: Partial<Ticket> | AddressInput | null;
  variant?: WorkOrderAddressVariant;
  showIcon?: boolean;
  fallbackText?: string;
  className?: string;
  /** Optional prefix on first line (e.g. "Target:") */
  prefixLabel?: string;
}

export const WorkOrderAddressBlock: React.FC<WorkOrderAddressBlockProps> = ({
  ticket,
  variant = 'card',
  showIcon = true,
  fallbackText = 'Alamat belum tersedia',
  className = '',
  prefixLabel
}) => {
  const formatted = React.useMemo(() => formatWorkOrderAddress(ticket), [ticket]);

  const isBanner = variant === 'banner';
  const isCamera = variant === 'camera';
  const isDetail = variant === 'detail';

  const primaryLineClass = isBanner
    ? 'text-[12px] font-semibold text-white leading-snug'
    : isCamera
    ? 'text-[11.5px] font-semibold text-[#f5eeff] leading-snug'
    : isDetail
    ? 'text-[12px] font-semibold text-[#26364A] dark:text-[#f5eeff] leading-snug'
    : 'text-[11.5px] font-semibold text-[#26364A] dark:text-[#f5eeff] leading-snug';

  const secondaryLineClass = isBanner
    ? 'text-[11px] text-white/85 leading-snug'
    : isCamera
    ? 'text-[11px] text-[#cbc3d7] leading-snug'
    : isDetail
    ? 'text-[11.5px] text-[#52647A] dark:text-[#C4B5D6] leading-snug'
    : 'text-[11px] text-[#52647A] dark:text-[#C4B5D6] leading-snug';

  const additionalRowClass = isBanner
    ? 'mt-1 pt-1 border-t border-white/20 text-[10.5px] text-[#DDF4F4] leading-snug flex items-start gap-1'
    : isCamera
    ? 'mt-1 pt-1 border-t border-white/15 text-[10.5px] text-[#d0bcff] leading-snug flex items-start gap-1'
    : 'mt-1 pt-1 border-t border-[#DDE6F0]/80 dark:border-[#35105E]/80 text-[10.5px] text-[#5145A6] dark:text-[#DAB9FF] leading-snug flex items-start gap-1';

  const iconColorClass = isBanner
    ? 'text-[#DDF4F4]'
    : isCamera
    ? 'text-[#d0bcff]'
    : 'text-[#2E7D8B] dark:text-[#A380FE]';

  if (!formatted.hasAddress) {
    return (
      <div className={`flex items-start gap-1.5 min-w-0 ${className}`}>
        {showIcon && <MapPin className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${iconColorClass}`} />}
        <span className={`${secondaryLineClass} whitespace-normal [overflow-wrap:break-word]`}>
          {prefixLabel ? `${prefixLabel} ${fallbackText}` : fallbackText}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex items-start gap-1.5 min-w-0 ${className}`} data-testid="wo-address-block">
      {showIcon && <MapPin className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${iconColorClass}`} />}
      <div className="min-w-0 flex-1 space-y-0.5 whitespace-normal [overflow-wrap:break-word]">
        {formatted.lines.map((line, index) => (
          <div
            key={`${index}-${line}`}
            className={index === 0 ? primaryLineClass : secondaryLineClass}
          >
            {index === 0 && prefixLabel ? `${prefixLabel} ${line}` : line}
          </div>
        ))}

        {formatted.additionalLocations.length > 0 && (
          <div className={additionalRowClass}>
            <Compass className="w-3 h-3 shrink-0 mt-0.5 opacity-85" />
            <div className="min-w-0 flex-1 whitespace-normal [overflow-wrap:break-word]">
              <span className="font-semibold">Lokasi Tambahan: </span>
              <span>{formatted.additionalLocations.join(' · ')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
