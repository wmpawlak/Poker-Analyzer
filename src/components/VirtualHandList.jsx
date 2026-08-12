import { useEffect, useRef } from 'react';
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
  const loadMoreRef = useRef(onLoadMore);
  const sentinelRef = useRef(null);

  useEffect(() => {
    loadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage || isLoading) return undefined;
    if (!globalThis.IntersectionObserver) {
      loadMoreRef.current?.();
      return undefined;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) loadMoreRef.current?.();
    }, { rootMargin: '240px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hands.length, hasNextPage, isLoading, resetKey]);

  if (hands.length === 0 && !isLoading) {
    return <div className="mt-10 text-center text-gray-400">{emptyMessage}</div>;
  }

  return (
    <div data-testid="virtual-hand-list" data-reset-key={resetKey} className="min-w-0">
      {hands.map((hand) => <HandTile key={hand.id} hand={hand} onClick={onHandClick}/>)}
      {isLoading && <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center text-xs font-semibold text-slate-500">Wczytywanie rąk…</div>}
      {hasNextPage && !isLoading && <div ref={sentinelRef} data-testid="hand-list-load-more" className="h-px" aria-hidden="true"/>}
    </div>
  );
};
