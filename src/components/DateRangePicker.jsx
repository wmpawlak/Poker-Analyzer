import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { DayPicker } from '@daypicker/react';
import { pl } from '@daypicker/react/locale';
import { CalendarDays, ChevronDown, RotateCcw } from 'lucide-react';
import { dateStringToLocalDate, localDateToDateString } from '../utils/dateRange.js';
import { getDateRangePresets } from '../utils/dateRangePresets.js';

const EMPTY_RANGE = Object.freeze({ from: '', to: '' });

const formatDate = (date) => new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric', month: 'short', year: 'numeric',
}).format(date);

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const media = window.matchMedia('(max-width: 639px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isMobile;
};

const labelForRange = (range) => {
  const from = dateStringToLocalDate(range?.from);
  const to = dateStringToLocalDate(range?.to);
  if (from && to) return `${formatDate(from)} — ${formatDate(to)}`;
  if (from) return `Od ${formatDate(from)}`;
  if (to) return `Do ${formatDate(to)}`;
  return 'Cała historia';
};

export const DateRangePicker = ({
  value = EMPTY_RANGE,
  onChange = () => {},
  label = 'Zakres dat',
  today,
  initiallyOpen = false,
  disabled = false,
}) => {
  const pickerId = useId();
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(Boolean(initiallyOpen));
  const [draftStart, setDraftStart] = useState(null);
  const currentDate = useMemo(() => {
    const source = today instanceof Date ? today : new Date();
    return dateStringToLocalDate(localDateToDateString(source)) || new Date();
  }, [today]);
  const selectedRange = useMemo(() => {
    const from = dateStringToLocalDate(value?.from);
    const to = dateStringToLocalDate(value?.to);
    return from && to ? { from, to } : undefined;
  }, [value?.from, value?.to]);
  const presets = useMemo(() => getDateRangePresets(currentDate), [currentDate]);
  const calendarMonth = draftStart || selectedRange?.from || currentDate;

  const closePicker = useCallback(({ restoreFocus = false } = {}) => {
    setDraftStart(null);
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePicker({ restoreFocus: true });
      }
    };
    const onPointerDown = (event) => {
      if (!popoverRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) closePicker();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [closePicker, isOpen]);

  const applyRange = (range) => {
    onChange({ from: range?.from || '', to: range?.to || '' });
    closePicker();
  };

  const handleSelect = (nextRange) => {
    if (!nextRange?.from) return;
    if (!draftStart || !nextRange.to) {
      setDraftStart(nextRange.from);
      return;
    }
    applyRange({
      from: localDateToDateString(nextRange.from),
      to: localDateToDateString(nextRange.to),
    });
  };

  return (
    <div className="date-range-picker relative" data-testid="date-range-picker">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-controls={isOpen ? pickerId : undefined}
        onClick={() => (isOpen ? closePicker() : setIsOpen(true))}
        className="inline-flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex min-w-0 items-center gap-2"><CalendarDays size={16} className="shrink-0 text-slate-400" /><span className="truncate">{labelForRange(value)}</span></span>
        <ChevronDown size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          id={pickerId}
          role="dialog"
          aria-label={label}
          className="absolute z-30 mt-2 w-max max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
        >
          <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Szybki wybór zakresu dat">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyRange(preset.range)}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => applyRange(EMPTY_RANGE)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <RotateCcw size={12} aria-hidden="true" /> Wyczyść
            </button>
          </div>

          <DayPicker
            mode="range"
            locale={pl}
            selected={draftStart ? { from: draftStart } : selectedRange}
            onSelect={handleSelect}
            resetOnSelect
            defaultMonth={calendarMonth}
            endMonth={currentDate}
            disabled={{ after: currentDate }}
            numberOfMonths={isMobile ? 1 : 2}
            pagedNavigation
            showOutsideDays
            footer={<p aria-live="polite" className="mt-2 text-center text-xs font-medium text-slate-500">{draftStart ? 'Wybierz datę końcową zakresu.' : 'Wybierz datę początkową zakresu.'}</p>}
          />
        </div>
      )}
    </div>
  );
};
