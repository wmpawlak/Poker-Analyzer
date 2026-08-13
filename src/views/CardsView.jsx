// src/views/CardsView.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { CardIcon } from '../components/CardIcon.jsx';
import { DateRangePicker } from '../components/DateRangePicker.jsx';
import { Download, Grid, Maximize2, Minimize2, X } from 'lucide-react';
import { STARTING_HAND_RANKS } from '../utils/startingHandStats.js';
import { fetchCards, setDateRange } from '../store/pokerSlice.js';

const HEATMAP_EXPORT_SCALE = 2;
// Ręcznie zmieniaj tę wartość, aby zwiększyć lub zmniejszyć wszystkie fonty w JPEG-u.
const HEATMAP_EXPORT_FONT_SCALE = 1.2;
const getHeatmapExportFont = (weight, size) => (
  `${weight} ${Math.round(size * HEATMAP_EXPORT_FONT_SCALE)}px Inter, ui-sans-serif, system-ui, sans-serif`
);
const HEATMAP_EXPORT_COLORS = {
  none: { fill: '#ffffff', text: '#cbd5e1', border: '#e2e8f0' },
  insufficient: { fill: '#cbd5e1', text: '#334155', border: '#94a3b8' },
  critical: { fill: '#be123c', text: '#ffffff', border: '#9f1239' },
  pink: { fill: '#fb7185', text: '#4c0519', border: '#f43f5e' },
  yellow: { fill: '#fcd34d', text: '#451a03', border: '#fbbf24' },
  'light-green': { fill: '#bef264', text: '#365314', border: '#a3e635' },
  green: { fill: '#34d399', text: '#022c22', border: '#10b981' },
  'dark-green': { fill: '#047857', text: '#ffffff', border: '#065f46' },
};

const getExportCountBadgeColors = (count, maxCount) => {
  const ratio = count / maxCount;
  if (ratio >= 0.75) return { fill: '#22c55e', text: '#ffffff' };
  if (ratio >= 0.55) return { fill: '#a3e635', text: '#365314' };
  if (ratio >= 0.45) return { fill: '#fde047', text: '#422006' };
  if (ratio >= 0.20) return { fill: '#fb923c', text: '#ffffff' };
  return { fill: '#ef4444', text: '#ffffff' };
};

const drawRoundedRect = (context, x, y, width, height, radius) => {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
  context.stroke();
};

const getHeatmapGridCells = (type, handsByKey) => {
  const cells = [];

  STARTING_HAND_RANKS.forEach((firstRank, column) => {
    let row = 0;

    STARTING_HAND_RANKS.forEach((secondRank) => {
      let lookupKey;
      if (firstRank === secondRank) {
        if (type !== 'suited') return;
        lookupKey = firstRank + secondRank;
      } else if (type === 'suited') {
        if (STARTING_HAND_RANKS.indexOf(firstRank) > STARTING_HAND_RANKS.indexOf(secondRank)) return;
        lookupKey = firstRank + secondRank + 's';
      } else {
        if (STARTING_HAND_RANKS.indexOf(firstRank) > STARTING_HAND_RANKS.indexOf(secondRank)) return;
        lookupKey = firstRank + secondRank + 'o';
      }

      const hand = handsByKey.get(lookupKey);
      if (hand) cells.push({ column, row: row++, firstRank, secondRank, hand });
    });
  });

  return cells;
};

export const CardsView = () => {
  const dispatch = useDispatch();
  const gameType = useSelector((state) => state.poker.filters.gameType);
  const cardsDateRange = useSelector((state) => state.poker.filters.dateRanges.cards);
  const { from: cardsDateFrom, to: cardsDateTo } = cardsDateRange;
  const cards = useSelector((state) => state.poker.aggregates.cards);
  const [cardTypeFilter, setCardTypeFilter] = useState('all');
  const [viewMode, setViewMode] = useState('classic'); // 'classic' lub 'advanced'
  const [cardsSortBy, setCardsSortBy] = useState('count');
  const [cardsSortOrder, setCardsSortOrder] = useState('desc');
  const [activeModal, setActiveModal] = useState(null); // 'suited', 'offsuit' lub null
  const [isHeatmapFullscreen, setIsHeatmapFullscreen] = useState(false);
  const [isExportingHeatmap, setIsExportingHeatmap] = useState(false);
  const [heatmapExportError, setHeatmapExportError] = useState('');
  const [riverOrShowdownOnly, setRiverOrShowdownOnly] = useState(false);
  const [heatmapLayout, setHeatmapLayout] = useState({ scale: 1, width: 0, height: 0 });
  const heatmapRef = useRef(null);
  const heatmapViewportRef = useRef(null);
  const heatmapGridRef = useRef(null);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsHeatmapFullscreen(document.fullscreenElement === heatmapRef.current);
    };

    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  useEffect(() => {
    if (!activeModal) return undefined;

    const viewport = heatmapViewportRef.current;
    const grid = heatmapGridRef.current;
    if (!viewport || !grid) return undefined;

    let animationFrameId;
    const updateHeatmapLayout = () => {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(() => {
        const viewportStyle = window.getComputedStyle(viewport);
        const horizontalPadding = parseFloat(viewportStyle.paddingLeft) + parseFloat(viewportStyle.paddingRight);
        const verticalPadding = parseFloat(viewportStyle.paddingTop) + parseFloat(viewportStyle.paddingBottom);
        const availableWidth = Math.max(viewport.clientWidth - horizontalPadding, 1);
        const availableHeight = Math.max(viewport.clientHeight - verticalPadding, 1);
        const gridWidth = grid.scrollWidth;
        const gridHeight = grid.scrollHeight;
        if (!gridWidth || !gridHeight) return;

        const scale = Math.min(1, availableWidth / gridWidth, availableHeight / gridHeight);
        setHeatmapLayout((currentLayout) => {
          if (
            currentLayout.width === gridWidth
            && currentLayout.height === gridHeight
            && Math.abs(currentLayout.scale - scale) < 0.001
          ) {
            return currentLayout;
          }

          return { scale, width: gridWidth, height: gridHeight };
        });
      });
    };

    const resizeObserver = new ResizeObserver(updateHeatmapLayout);
    resizeObserver.observe(viewport);
    resizeObserver.observe(grid);
    updateHeatmapLayout();

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
    };
  }, [activeModal]);

  const toggleHeatmapFullscreen = async () => {
    if (document.fullscreenElement === heatmapRef.current) {
      await document.exitFullscreen();
      return;
    }

    await heatmapRef.current?.requestFullscreen();
  };

  const closeHeatmap = () => {
    if (document.fullscreenElement === heatmapRef.current) {
      document.exitFullscreen();
    }
    setActiveModal(null);
  };

  const exportHeatmap = async () => {
    if (!activeModal || isExportingHeatmap) return;

    setIsExportingHeatmap(true);
    setHeatmapExportError('');

    try {
      const currentHands = Array.isArray(cards.data?.hands) ? cards.data.hands : [];
      const handsByKey = new Map(currentHands.map((hand) => [hand.key, hand]));
      const maxExportCount = Math.max(...currentHands.map((hand) => Number(hand.count) || 0), 1);
      const exportDateRangeLabel = cardsDateFrom || cardsDateTo
        ? `${cardsDateFrom || 'początek historii'} — ${cardsDateTo || 'dziś'}`
        : 'cała historia';
      const cells = getHeatmapGridCells(activeModal, handsByKey);
      const cellWidth = 144;
      const cellHeight = 104;
      const cellGap = 10;
      const padding = 64;
      const headerHeight = 190;
      const badgeOverflow = 28;
      const maxRows = Math.max(...cells.map((cell) => cell.row + 1), 1);
      const gridWidth = STARTING_HAND_RANKS.length * cellWidth + (STARTING_HAND_RANKS.length - 1) * cellGap;
      const gridHeight = maxRows * cellHeight + (maxRows - 1) * cellGap;
      const legendTop = headerHeight + gridHeight + 48;
      const legendHeight = 180;
      const canvasWidth = padding * 2 + gridWidth + badgeOverflow;
      const canvasHeight = legendTop + legendHeight + padding;
      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth * HEATMAP_EXPORT_SCALE;
      canvas.height = canvasHeight * HEATMAP_EXPORT_SCALE;

      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas context is unavailable');
      context.scale(HEATMAP_EXPORT_SCALE, HEATMAP_EXPORT_SCALE);
      context.textBaseline = 'middle';

      context.fillStyle = '#f8fafc';
      context.fillRect(0, 0, canvasWidth, canvasHeight);
      context.fillStyle = '#ffffff';
      context.strokeStyle = '#e2e8f0';
      context.lineWidth = 2;
      drawRoundedRect(context, 18, 18, canvasWidth - 36, canvasHeight - 36, 26);

      context.fillStyle = '#1e293b';
      context.font = getHeatmapExportFont(900, 34);
      context.fillText('Mapa Termiczna Układów', padding, 65);
      context.fillStyle = '#475569';
      context.font = getHeatmapExportFont(600, 19);
      context.fillText(activeModal === 'suited' ? 'Pary & Suited' : 'Off-Suit', padding, 105);
      context.fillText(`Zakres: ${exportDateRangeLabel}`, padding, 137);
      if (riverOrShowdownOnly) context.fillText('River / Showdown (Hero)', padding, 162);

      cells.forEach(({ column, row, firstRank, secondRank, hand }) => {
        const x = padding + column * (cellWidth + cellGap);
        const y = headerHeight + row * (cellHeight + cellGap);
        const colors = HEATMAP_EXPORT_COLORS[hand.colorTier] || HEATMAP_EXPORT_COLORS.none;
        const count = Number(hand.count) || 0;
        const winRate = Number(hand.winRate) || 0;

        context.fillStyle = colors.fill;
        context.strokeStyle = colors.border;
        context.lineWidth = 2;
        drawRoundedRect(context, x, y, cellWidth, cellHeight, 16);

        context.fillStyle = colors.text;
        context.textAlign = 'center';
        context.font = getHeatmapExportFont(900, 25);
        context.fillText(`${firstRank}-${secondRank}`, x + cellWidth / 2, y + 38);
        if (count > 0) {
          context.font = getHeatmapExportFont(900, 20);
          context.fillText(`${winRate.toFixed(0)}%`, x + cellWidth / 2, y + 70);
        }
      });

      // Kółka są rysowane po wszystkich kafelkach, aby zawsze były na pierwszej warstwie.
      cells.forEach(({ column, row, hand }) => {
        const count = Number(hand.count) || 0;
        if (count <= 0) return;

        const x = padding + column * (cellWidth + cellGap);
        const y = headerHeight + row * (cellHeight + cellGap);
        const badgeColors = getExportCountBadgeColors(count, maxExportCount);
        context.fillStyle = badgeColors.fill;
        context.strokeStyle = '#0f172a';
        context.lineWidth = 2;
        context.beginPath();
        context.arc(x + cellWidth + 4, y + 4, 20, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        context.fillStyle = badgeColors.text;
        context.textAlign = 'center';
        context.font = getHeatmapExportFont(900, 15);
        context.fillText(String(count), x + cellWidth + 4, y + 5);
      });

      const legend = [
        ['#047857', '≥ 85%'], ['#34d399', '70–84%'], ['#bef264', '56–69%'],
        ['#fcd34d', '45–55%'], ['#fb7185', '25–44%'], ['#be123c', '< 25%'],
        ['#cbd5e1', 'Próba < 10'], ['#ffffff', 'Brak danych'],
      ];
      context.textAlign = 'left';
      context.fillStyle = '#475569';
      context.font = getHeatmapExportFont(900, 20);
      context.fillText('LEGENDA KOLORÓW WYGRYWALNOŚCI', padding, legendTop + 14);
      context.font = getHeatmapExportFont(600, 16);
      context.fillText('Kółko = liczba rozdań; jego kolor pokazuje częstotliwość względem maksimum.', padding, legendTop + 42);
      legend.forEach(([color, label], index) => {
        const itemWidth = 260;
        const x = padding + (index % 4) * itemWidth;
        const y = legendTop + 82 + Math.floor(index / 4) * 42;
        context.fillStyle = color;
        context.strokeStyle = '#cbd5e1';
        context.lineWidth = 2;
        drawRoundedRect(context, x, y - 13, 26, 26, 6);
        context.fillStyle = '#475569';
        context.font = getHeatmapExportFont(700, 18);
        context.fillText(label, x + 38, y);
      });

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error('JPEG export failed'));
        }, 'image/jpeg', 0.95);
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const configName = activeModal === 'suited' ? 'pary-suited' : 'off-suit';
      const rangeName = `${cardsDateFrom || 'poczatek'}-${cardsDateTo || 'dzis'}`.replace(/[^a-z0-9-]+/gi, '-');
      link.href = url;
      link.download = `heatmapa-kart-startowych-${configName}-${rangeName}.jpg`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setHeatmapExportError('Nie udało się przygotować pliku JPEG.');
      console.error(error);
    } finally {
      setIsExportingHeatmap(false);
    }
  };

  useEffect(() => {
    dispatch(fetchCards({ gameType, dateFrom: cardsDateFrom, dateTo: cardsDateTo, riverOrShowdownOnly }));
  }, [cardsDateFrom, cardsDateTo, dispatch, gameType, riverOrShowdownOnly]);

  const all169HandsData = useMemo(
    () => (Array.isArray(cards.data?.hands) ? cards.data.hands : []),
    [cards.data],
  );

  const maxCount = useMemo(() => Math.max(...all169HandsData.map(h => h.count), 1), [all169HandsData]);
  const cardsMetadata = cards.data || {};
  const activeDateRangeLabel = cardsDateFrom || cardsDateTo
    ? `${cardsDateFrom || 'początek historii'} — ${cardsDateTo || 'dziś'}`
    : 'cała historia';
  const excludedByReason = cardsMetadata.excludedByReason || {};

  const filtered169Hands = useMemo(() => {
    let result = cardTypeFilter === 'all' ? [...all169HandsData] : all169HandsData.filter(h => h.type === cardTypeFilter);
    return result.sort((a, b) => {
      let valA = a[cardsSortBy]; let valB = b[cardsSortBy];
      if (valB !== valA) return cardsSortOrder === 'desc' ? valB - valA : valA - valB;
      return b.count - a.count;
    });
  }, [all169HandsData, cardTypeFilter, cardsSortBy, cardsSortOrder]);

  // Stałe progi koloru odpowiadają surowemu Win Rate.
  const getHeatmapColor = (hand) => {
    if (!hand || hand.count === 0) return 'bg-white text-gray-300 border-gray-200 opacity-50';
    if (hand.colorTier === 'insufficient') return 'bg-slate-300 text-slate-700 font-bold border-slate-400 shadow-sm';
    if (hand.colorTier === 'critical') return 'bg-rose-700 text-white font-bold border-rose-800 shadow-sm';
    if (hand.colorTier === 'pink') return 'bg-rose-400 text-rose-950 font-bold border-rose-500 shadow-sm';
    if (hand.colorTier === 'yellow') return 'bg-amber-300 text-amber-950 font-bold border-amber-400 shadow-sm';
    if (hand.colorTier === 'light-green') return 'bg-lime-300 text-lime-950 font-bold border-lime-400 shadow-sm';
    if (hand.colorTier === 'green') return 'bg-emerald-400 text-emerald-950 font-bold border-emerald-500 shadow-sm';
    return 'bg-emerald-700 text-white font-bold border-emerald-800 shadow-sm';
  };

  // Funkcja przypisująca stonowany kolor dymka częstotliwości (dymek żółty przy 50% wartości maxCount)
  const getCountBadgeColor = (count) => {
    if (count === 0) return 'hidden';
    const ratio = count / maxCount;
    if (ratio >= 0.75) return 'bg-green-500 text-white';
    if (ratio >= 0.55) return 'bg-lime-400 text-lime-950';
    if (ratio >= 0.45) return 'bg-yellow-300 text-yellow-950'; 
    if (ratio >= 0.20) return 'bg-orange-400 text-white';
    return 'bg-red-500 text-white';
  };

  // Renderowanie schodkowej siatki rąk startowych
const renderGrid = (type) => {
    const ranks = STARTING_HAND_RANKS;
    
    return (
      // Flex-row sprawia, że kolumny (pierwsza karta) są obok siebie
      <div className="flex flex-row gap-1.5 justify-center">
        {ranks.map((firstRank) => (
          // Flex-col sprawia, że karty wewnątrz kolumny są jedna pod drugą
          <div key={firstRank} className="flex flex-col gap-1.5 w-20">
            {ranks.map((secondRank) => {
              let lookupKey = "";
              
              // LOGIKA:
              // 1. Jeśli to PARA (AA, KK...) -> tylko w widoku 'suited'
              if (firstRank === secondRank) {
                if (type !== 'suited') return null;
                lookupKey = firstRank + secondRank;
              } 
              // 2. Jeśli to SUITED -> tylko jeśli type == 'suited'
              else if (type === 'suited') {
                // Wyświetlamy tylko układ w jednym kierunku (np. AKs), żeby nie duplikować (np. KAs)
                if (ranks.indexOf(firstRank) > ranks.indexOf(secondRank)) return null;
                lookupKey = firstRank + secondRank + 's';
              } 
              // 3. Jeśli to OFF-SUIT -> tylko jeśli type == 'offsuit'
              else { 
                if (type !== 'offsuit') return null; // Ukrywamy pary w off-suit
                if (ranks.indexOf(firstRank) > ranks.indexOf(secondRank)) return null;
                lookupKey = firstRank + secondRank + 'o';
              }

              const handObj = all169HandsData.find(h => h.key === lookupKey);
              if (!handObj) return null;

              const colorClass = getHeatmapColor(handObj);
              const badgeColorClass = handObj ? getCountBadgeColor(handObj.count) : 'hidden';

              return (
                <div 
                  key={lookupKey} 
                  className={`w-20 h-16 flex flex-col items-center justify-center rounded-xl border cursor-default transition-all hover:scale-110 hover:!z-50 relative ${colorClass}`}
                  title={`${lookupKey}: Rozegrano ${handObj.count} | WR: ${handObj.winRate.toFixed(1)}%`}
                >
                  {handObj.count > 0 && (
                    <div className={`absolute -top-3 -right-3 w-8 h-8 rounded-full border border-black flex items-center justify-center text-sm font-black shadow-md select-none z-40 ${badgeColorClass}`}>
                      {handObj.count}
                    </div>
                  )}
                  <span className="text-base font-black tracking-tighter leading-none">{firstRank}-{secondRank}</span>
                  {handObj.count > 0 && (
                    <span className="text-sm leading-none font-black mt-1">{handObj.winRate.toFixed(0)}%</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto bg-white p-6 rounded-2xl shadow-sm border border-gray-200 animate-in fade-in duration-300 flex flex-col h-[calc(100vh-140px)] relative">
      {cards.status === 'failed' && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{cards.error}</div>}
      {cards.status === 'loading' && all169HandsData.length === 0 && <div role="status" className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm font-semibold text-indigo-700">Pobieranie 169 agregatów kart startowych…</div>}
      
      {/* NAKŁADKA MODALA (Heatmapy) */}
      {activeModal && (
        <div
          ref={heatmapRef}
          className={`absolute inset-0 z-40 bg-white/95 backdrop-blur-md flex flex-col p-8 animate-in fade-in zoom-in-95 ${isHeatmapFullscreen ? 'rounded-none' : 'rounded-2xl'}`}
        >
          <div className="flex flex-col gap-4 xl:flex-row xl:justify-between xl:items-center mb-4 border-b pb-4 shrink-0">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:flex-wrap">
              <div>
                <h2 className="text-2xl font-black text-gray-800">Mapa Termiczna Układów</h2>
                <p className="text-sm text-gray-500 mt-1">Procent i kolor = surowy WR. Kółeczko = liczba rozdań.</p>
              </div>

              {/* TOGGLE WEWNĄTRZ MODALA */}
              <div className="flex bg-slate-100 p-1 rounded-xl border border-gray-200 shadow-inner z-50">
                <button 
                  onClick={() => setActiveModal('suited')} 
                  className={`px-5 py-2 rounded-lg text-xs font-black transition-all ${activeModal === 'suited' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-600 hover:bg-slate-200'}`}
                >
                  Pary & Suited
                </button>
                <button 
                  onClick={() => setActiveModal('offsuit')} 
                  className={`px-5 py-2 rounded-lg text-xs font-black transition-all ${activeModal === 'offsuit' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-600 hover:bg-slate-200'}`}
                >
                  Off-Suit
                </button>
              </div>

              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 cursor-pointer z-50">
                <input
                  type="checkbox"
                  checked={riverOrShowdownOnly}
                  onChange={(event) => setRiverOrShowdownOnly(event.target.checked)}
                  className="size-4 accent-indigo-600"
                />
                River / Showdown (Hero)
              </label>
            </div>

            <div className="flex items-center gap-2 self-end xl:self-auto">
              <button
                type="button"
                onClick={exportHeatmap}
                disabled={isExportingHeatmap}
                className="p-2.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:cursor-wait disabled:opacity-60 rounded-full transition-colors z-50"
                title="Pobierz aktualną mapę jako JPEG"
                aria-label="Pobierz aktualną mapę termiczną jako JPEG"
              >
                <Download size={24} />
              </button>
              <button
                type="button"
                onClick={toggleHeatmapFullscreen}
                className="p-2.5 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors z-50"
                title={isHeatmapFullscreen ? 'Wyjdź z pełnego ekranu' : 'Otwórz na pełnym ekranie'}
                aria-label={isHeatmapFullscreen ? 'Wyjdź z pełnego ekranu' : 'Otwórz mapę na pełnym ekranie'}
              >
                {isHeatmapFullscreen
                  ? <Minimize2 size={24} className="text-slate-600" />
                  : <Maximize2 size={24} className="text-slate-600" />}
              </button>
              <button
                type="button"
                onClick={closeHeatmap}
                className="p-2.5 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors z-50"
                title="Zamknij mapę"
                aria-label="Zamknij mapę termiczną"
              >
                <X size={24} className="text-slate-600" />
              </button>
            </div>
          </div>
          {heatmapExportError && <div role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 shrink-0">{heatmapExportError}</div>}
          
          {/* Legenda */}
          <div className="flex gap-5 mb-4 text-xs font-bold uppercase tracking-wider text-gray-600 flex-wrap bg-slate-50 p-3 rounded-xl border shrink-0">
             <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-emerald-700"></div> &ge; 85%</div>
             <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-emerald-400"></div> 70-84%</div>
             <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-lime-300"></div> 56-69%</div>
             <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-amber-300"></div> 45-55%</div>
             <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-rose-400"></div> 25-44%</div>
             <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-rose-700"></div> &lt; 25%</div>
             <div className="flex items-center gap-2 ml-4"><div className="w-4 h-4 rounded bg-slate-300 border border-slate-400"></div> Próbka &lt; 10</div>
             <div className="flex items-center gap-2 ml-4"><div className="w-4 h-4 rounded bg-white border border-gray-200"></div> Brak danych</div>
          </div>

          <div ref={heatmapViewportRef} className="flex-1 min-h-0 min-w-0 overflow-auto custom-scrollbar p-2">
            <div
              className="mx-auto overflow-hidden"
              style={{
                width: heatmapLayout.width ? `${heatmapLayout.width * heatmapLayout.scale}px` : 'max-content',
                height: heatmapLayout.height ? `${heatmapLayout.height * heatmapLayout.scale}px` : 'auto',
              }}
            >
              <div
                ref={heatmapGridRef}
                className="w-max origin-top-left p-4"
                style={{ transform: `scale(${heatmapLayout.scale})` }}
              >
                {renderGrid(activeModal)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STANDARDOWY WIDOK LISTY */}
      <div className="border-b pb-4 mb-4 shrink-0 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-gray-800">Statystyka Rąk Startowych</h3>
          <p className="mt-1 text-xs text-slate-500">Zakres kart: <span className="font-bold text-slate-700">{activeDateRangeLabel}</span></p>
          <div className="flex gap-2 mt-2">
            <button onClick={() => setViewMode('classic')} className={`px-3 py-1 rounded-lg text-xs font-bold ${viewMode === 'classic' ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-600'}`}>Klasyczny</button>
            <button onClick={() => setViewMode('advanced')} className={`px-3 py-1 rounded-lg text-xs font-bold ${viewMode === 'advanced' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'}`}>Zaawansowany</button>
          </div>
        </div>
        
        <div className="flex flex-col gap-2 items-end">
          {/* PRZYCISKI DO OTWIERANIA MODALI */}
          <div className="flex gap-2">
            <button onClick={() => setActiveModal('suited')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 shadow-sm transition-colors">
              <Grid size={14}/> Mapa Par & Suited
            </button>
            <button onClick={() => setActiveModal('offsuit')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 shadow-sm transition-colors">
              <Grid size={14}/> Mapa Off-Suit
            </button>
          </div>
          
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl border">
            {['all', 'pair', 'suited', 'offsuit'].map(type => (
               <button key={type} onClick={() => setCardTypeFilter(type)} className={`px-2.5 py-1.5 rounded-lg text-xs font-bold ${cardTypeFilter === type ? 'bg-white shadow-sm' : ''}`}>
                 {type.toUpperCase()}
               </button>
            ))}
          </div>
        </div>
      </div>

      <section aria-label="Zakres dat kart startowych" className="mb-3 flex shrink-0 flex-col gap-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs text-slate-700 lg:flex-row lg:items-end lg:justify-between">
        <div className="w-full lg:max-w-sm" data-testid="cards-date-range">
          <DateRangePicker
            value={cardsDateRange}
            onChange={(range) => dispatch(setDateRange({ view: 'cards', ...range }))}
            label="Zakres dat kart startowych"
          />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-600">
          <span>Zindeksowane: <strong className="text-slate-900">{cardsMetadata.indexedHandCount ?? 0}</strong></span>
          <span>Klasy: <strong className="text-slate-900">{cardsMetadata.populatedClassCount ?? 0}/169</strong></span>
          {Number(excludedByReason.unsupportedVariant) > 0 && <span>Pominięto warianty poza NLH i NLH BombPot: <strong className="text-slate-900">{excludedByReason.unsupportedVariant}</strong></span>}
          {Number(excludedByReason.invalidHeroCards) > 0 && <span>Nieprawidłowe karty Hero: <strong className="text-slate-900">{excludedByReason.invalidHeroCards}</strong></span>}
        </div>
      </section>
      
      <div className="flex justify-between items-center bg-slate-50 p-2 rounded-xl text-xs gap-3 border mb-3 shrink-0">
        <div className="flex items-center gap-3">
          <select value={cardsSortBy} onChange={(e) => setCardsSortBy(e.target.value)} className="bg-transparent font-bold cursor-pointer outline-none">
            <option value="count">Sortuj: Częstotliwość</option>
            <option value="wins">Sortuj: Wygrane</option>
            <option value="losses">Sortuj: Przegrane</option>
            <option value="winRate">Sortuj: Win Rate</option>
          </select>
          <select value={cardsSortOrder} onChange={(e) => setCardsSortOrder(e.target.value)} className="bg-transparent font-bold cursor-pointer outline-none">
            <option value="desc">Malejąco</option>
            <option value="asc">Rosnąco</option>
          </select>
        </div>
        <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={riverOrShowdownOnly}
            onChange={(event) => setRiverOrShowdownOnly(event.target.checked)}
            className="size-4 accent-indigo-600"
          />
          River / Showdown (Hero)
        </label>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar flex flex-col gap-2">
        {filtered169Hands.map((hand) => {
          if (hand.count === 0) return null;
          const widthPercent = (hand.count / maxCount) * 100;

          return (
            <div key={hand.key} className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 border border-gray-200 bg-white shadow-sm">
              <div className="w-14 shrink-0 flex gap-0.5 justify-center scale-110"><CardIcon cardStr={hand.cards[0]} /><CardIcon cardStr={hand.cards[1]} /></div>
              
              <div className="flex-1 flex flex-col gap-1">
                 <div className="text-[10px] font-bold text-gray-500 uppercase">{hand.labelText}</div>
                 
                 {viewMode === 'classic' ? (
                   <div className="bg-slate-100 h-5 rounded-md flex overflow-hidden border border-gray-200" style={{ width: `${widthPercent}%` }}>
                     {hand.wins > 0 && <div className="bg-emerald-500 h-full" style={{ width: `${(hand.wins / hand.count) * 100}%` }} />}
                     {hand.losses > 0 && <div className="bg-rose-500 h-full" style={{ width: `${(hand.losses / hand.count) * 100}%` }} />}
                   </div>
                 ) : (
                   <div className="bg-indigo-100 h-5 rounded-md flex overflow-hidden border border-indigo-200 w-full">
                      <div className="bg-indigo-500 h-full" style={{ width: `${hand.winRate}%` }} />
                   </div>
                 )}
              </div>
              <div className="text-[10px] font-mono text-gray-500 w-24 text-right">
                <div>{viewMode === 'classic' ? `W:${hand.wins} P:${hand.losses}` : `${hand.winRate.toFixed(1)}% WR`}</div>
                <div>N:{hand.count}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
