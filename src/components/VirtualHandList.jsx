import { useEffect, useLayoutEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { HandTile } from './HandTile.jsx';

export const VirtualHandList = ({
  hands = [],
  onHandClick,
  onLoadMore,
  hasNextPage = false,
  isLoading = false,
  resetKey = '',
  emptyMessage = 'Brak rozdań.',
}) => {
  const scrollElementRef = useRef(null);
  const rowCount = hands.length + (hasNextPage ? 1 : 0);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElementRef.current,
    getItemKey: (index) => String(hands[index]?.id || `loading-${index}`),
    estimateSize: () => 92,
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();

  useLayoutEffect(() => {
    const scrollElement = scrollElementRef.current;
    if (!scrollElement) return;
    scrollElement.scrollTop = 0;
    virtualizer.scrollToOffset(0, { align: 'start' });
    virtualizer.measure();
  }, [resetKey, virtualizer]);

  useEffect(() => {
    const last = virtualItems.at(-1);
    if (!last || !hasNextPage || isLoading || last.index < hands.length - 8) return;
    onLoadMore?.();
  }, [hands.length, hasNextPage, isLoading, onLoadMore, virtualItems]);

  if (hands.length === 0 && !isLoading) {
    return <div className="mt-10 text-center text-gray-400">{emptyMessage}</div>;
  }

  return (
    <div ref={scrollElementRef} data-testid="virtual-hand-list" data-reset-key={resetKey} className="min-h-0 flex-1 overflow-y-auto pr-2 custom-scrollbar">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}>
        {virtualItems.map((virtualItem) => {
          const hand = hands[virtualItem.index];
          return (
            <div
              key={hand?.id || 'loading-more'}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {hand
                ? <HandTile hand={hand} onClick={onHandClick}/>
                : <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center text-xs font-semibold text-slate-500">Wczytywanie kolejnych rąk…</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
};
