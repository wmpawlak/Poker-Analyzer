import { useEffect, useMemo, useRef } from 'react';
import { ChevronDown, LoaderCircle, RotateCcw } from 'lucide-react';
import { VirtualSessionList } from './VirtualSessionList.jsx';

const VIRTUALIZATION_THRESHOLD = 30;

const monthFormatter = new Intl.DateTimeFormat('pl-PL', { month: 'long', timeZone: 'UTC' });

const monthLabel = ({ year, month }) => {
  const label = monthFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
};

export const SessionMonthAccordion = ({
  months = [],
  activeMonthKey = null,
  pagesByMonth = {},
  onMonthToggle,
  onLoadMonth,
  onRetryMonth,
  renderSession,
  selectedCountsByMonth = {},
  mixed = false,
  emptyMessage = 'Brak sesji w tym miesiącu.',
}) => {
  const headerRefs = useRef(new Map());
  const scrollElementRef = useRef(null);
  const activePage = activeMonthKey ? pagesByMonth[activeMonthKey] : null;

  useEffect(() => {
    if (!activeMonthKey || activePage?.status === 'loading' || activePage?.status === 'succeeded') return;
    if (activePage?.status !== 'failed') onLoadMonth?.(activeMonthKey);
  }, [activeMonthKey, activePage?.status, onLoadMonth]);

  const panelIdByMonth = useMemo(() => Object.fromEntries(months.map(({ key }) => [
    key,
    `session-month-panel-${key}`,
  ])), [months]);

  const toggleMonth = (monthKey) => {
    const collapsing = activeMonthKey === monthKey;
    onMonthToggle?.(collapsing ? null : monthKey);
    if (!collapsing) return;
    globalThis.requestAnimationFrame?.(() => {
      const header = headerRefs.current.get(monthKey);
      header?.focus({ preventScroll: true });
      header?.scrollIntoView?.({ block: 'nearest' });
    });
  };

  return <div ref={scrollElementRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-2 custom-scrollbar" data-testid="session-month-accordion">
    {months.map((month) => {
      const expanded = activeMonthKey === month.key;
      const page = pagesByMonth[month.key];
      const loading = expanded && page?.status === 'loading';
      const failed = expanded && page?.status === 'failed';
      const selectedCount = Number(selectedCountsByMonth[month.key]) || 0;
      const accessibleName = `${monthLabel(month)} ${month.year}, ${month.sessionCount} sesji, ${month.handCount} rozdań`;
      return <section key={month.key} className="rounded-xl border border-slate-200 bg-white" data-month-key={month.key}>
        <div className="sticky top-0 z-[2] flex min-h-14 items-stretch rounded-xl bg-white shadow-sm">
          <button
            ref={(node) => {
              if (node) headerRefs.current.set(month.key, node);
              else headerRefs.current.delete(month.key);
            }}
            type="button"
            aria-expanded={expanded}
            aria-controls={panelIdByMonth[month.key]}
            aria-label={accessibleName}
            onClick={() => toggleMonth(month.key)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              toggleMonth(month.key);
            }}
            className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-black text-slate-800">{monthLabel(month)} <span className="font-semibold text-slate-500">{month.year}</span></span>
              <span className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <span>{month.sessionCount} sesji</span>
                <span>{month.handCount} rozdań</span>
                {mixed && <span>Cash {month.cashSessionCount} · Turnieje {month.tournamentSessionCount}</span>}
                {selectedCount > 0 && <span className="text-indigo-600">Wybrane: {selectedCount}</span>}
                {failed && <span className="text-red-600">Błąd ładowania</span>}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {loading && <LoaderCircle aria-label="Wczytywanie miesiąca" size={17} className="animate-spin text-indigo-600"/>}
              <ChevronDown aria-hidden="true" size={18} className={`text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`}/>
            </span>
          </button>
          {failed && <button
            type="button"
            onClick={() => onRetryMonth?.(month.key)}
            aria-label={`Ponów ładowanie: ${monthLabel(month)} ${month.year}`}
            className="m-2 ml-0 inline-flex items-center gap-1 rounded-lg px-2 text-xs font-bold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          ><RotateCcw size={14}/> Ponów</button>}
        </div>
        {expanded && <div id={panelIdByMonth[month.key]} role="region" aria-label={accessibleName} className="flex flex-col gap-2.5 border-t border-slate-100 p-2.5">
          {loading && !(page?.items?.length > 0) && <div className="p-6 text-center text-sm text-slate-400">Wczytywanie sesji…</div>}
          {failed && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{page.error || 'Nie udało się pobrać sesji.'}</div>}
          {page?.status === 'succeeded' && page.items.length === 0 && <div className="p-6 text-center text-sm text-slate-400">{emptyMessage}</div>}
          {page?.status === 'succeeded' && page.items.length > 0 && page.items.length <= VIRTUALIZATION_THRESHOLD
            && page.items.map((session) => renderSession(session))}
          {page?.status === 'succeeded' && page.items.length > VIRTUALIZATION_THRESHOLD && <VirtualSessionList
            sessions={page.items}
            renderSession={renderSession}
            scrollElementRef={scrollElementRef}
            ariaLabel={`Sesje: ${accessibleName}`}
            resetKey={`${month.key}:${page.items.map((session) => session.id).join('|')}`}
          />}
        </div>}
      </section>;
    })}
  </div>;
};
