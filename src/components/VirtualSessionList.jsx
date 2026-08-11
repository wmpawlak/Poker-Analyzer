import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

const ESTIMATED_SESSION_HEIGHT = 104;
const SESSION_GAP = 10;

export const VirtualSessionList = ({
  sessions = [],
  renderSession,
  scrollElementRef,
  ariaLabel,
  resetKey = '',
}) => {
  const listRef = useRef(null);
  const previousResetKeyRef = useRef(resetKey);
  const [scrollMargin, setScrollMargin] = useState(0);
  const sessionIdsKey = useMemo(
    () => sessions.map((session) => String(session.id)).join('\u001f'),
    [sessions],
  );

  // TanStack Virtual intentionally exposes an imperative instance that React Compiler skips.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => scrollElementRef?.current || null,
    getItemKey: (index) => String(sessions[index]?.id ?? index),
    estimateSize: () => ESTIMATED_SESSION_HEIGHT,
    overscan: 6,
    scrollMargin,
  });

  const updateScrollMargin = useCallback(() => {
    const scrollElement = scrollElementRef?.current;
    const listElement = listRef.current;
    if (!scrollElement || !listElement) return null;
    const nextMargin = Math.max(
      0,
      listElement.getBoundingClientRect().top
        - scrollElement.getBoundingClientRect().top
        + scrollElement.scrollTop,
    );
    setScrollMargin((current) => (Math.abs(current - nextMargin) < 0.5 ? current : nextMargin));
    return nextMargin;
  }, [scrollElementRef]);

  useLayoutEffect(() => {
    updateScrollMargin();
    const frame = globalThis.requestAnimationFrame?.(updateScrollMargin);
    return () => {
      if (frame !== undefined) globalThis.cancelAnimationFrame?.(frame);
    };
  });

  useLayoutEffect(() => {
    const resetChanged = previousResetKeyRef.current !== resetKey;
    previousResetKeyRef.current = resetKey;
    virtualizer.measure();
    const nextMargin = updateScrollMargin();
    if (resetChanged && nextMargin !== null && scrollElementRef?.current) {
      scrollElementRef.current.scrollTop = nextMargin;
    }
  }, [resetKey, scrollElementRef, sessionIdsKey, updateScrollMargin, virtualizer]);

  useLayoutEffect(() => {
    const scrollElement = scrollElementRef?.current;
    const listElement = listRef.current;
    if (!scrollElement || !listElement) return undefined;

    const resizeObserver = typeof globalThis.ResizeObserver === 'function'
      ? new globalThis.ResizeObserver(updateScrollMargin)
      : null;
    resizeObserver?.observe(scrollElement);
    resizeObserver?.observe(listElement);
    if (listElement.parentElement) resizeObserver?.observe(listElement.parentElement);

    globalThis.addEventListener?.('resize', updateScrollMargin);
    return () => {
      resizeObserver?.disconnect();
      globalThis.removeEventListener?.('resize', updateScrollMargin);
    };
  }, [scrollElementRef, updateScrollMargin]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={listRef}
      role="list"
      tabIndex={0}
      aria-label={ariaLabel}
      data-testid="virtual-session-list"
      data-reset-key={resetKey}
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        position: 'relative',
        width: '100%',
      }}
    >
      {virtualItems.map((virtualItem) => {
        const session = sessions[virtualItem.index];
        return (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            role="listitem"
            data-index={virtualItem.index}
            data-session-virtual-key={virtualItem.key}
            style={{
              boxSizing: 'border-box',
              left: 0,
              paddingBottom: `${SESSION_GAP}px`,
              position: 'absolute',
              top: 0,
              transform: `translateY(${virtualItem.start - scrollMargin}px)`,
              width: '100%',
            }}
          >
            {renderSession(session)}
          </div>
        );
      })}
    </div>
  );
};
