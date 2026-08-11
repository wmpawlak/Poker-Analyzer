import { lazy, Suspense, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Filter } from 'lucide-react';
import { DateRangePicker } from '../components/DateRangePicker.jsx';
import { fetchWallet, setDateRange } from '../store/pokerSlice.js';

const WalletTimelineChart = lazy(() => import('../components/WalletTimelineChart.jsx'));

const EMPTY_WALLET = {
  timeline: [],
  positionFrequencyData: [],
  maxPosHands: 1,
  totalHands: 0,
  totalProfit: 0,
};

const getWinRateColor = (winRate) => {
  if (winRate >= 60) return 'bg-emerald-500 border-emerald-600';
  if (winRate >= 50) return 'bg-yellow-400 border-yellow-500 text-black';
  return 'bg-red-500 border-red-600';
};

export const WalletView = () => {
  const dispatch = useDispatch();
  const dateRange = useSelector((state) => state.poker.filters.dateRanges.wallet);
  const { from: dateFrom, to: dateTo } = dateRange;
  const wallet = useSelector((state) => state.poker.aggregates.wallet);
  const [onlyFlop, setOnlyFlop] = useState(false);
  const walletData = wallet.data || EMPTY_WALLET;

  useEffect(() => {
    dispatch(fetchWallet({ dateFrom, dateTo, onlyFlop }));
  }, [dateFrom, dateTo, dispatch, onlyFlop]);

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <Filter className="text-gray-400" size={20}/>
        <span className="font-bold text-gray-700">Filtry:</span>
        <div className="w-full sm:max-w-sm" data-testid="wallet-date-range">
          <DateRangePicker
            value={dateRange}
            onChange={(range) => dispatch(setDateRange({ view: 'wallet', ...range }))}
            label="Zakres dat wykresów"
          />
        </div>
        <button onClick={() => setOnlyFlop((value) => !value)} className={`px-4 py-2 rounded-lg text-sm font-bold border transition-all ${onlyFlop ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white text-gray-600 border-gray-300'}`}>
          {onlyFlop ? '✓ Tylko ręce z flopem' : 'Pokaż wszystkie ręce'}
        </button>
        <span className="ml-auto text-xs font-semibold text-slate-500">{walletData.totalHands} rąk · {walletData.timeline.length}/1200 punktów</span>
      </div>

      {wallet.status === 'failed' && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{wallet.error}</div>}
      {wallet.status === 'loading' && !wallet.data && <div role="status" className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm font-semibold text-indigo-700">Pobieranie danych portfela…</div>}
      {wallet.status !== 'loading' && walletData.totalHands === 0 ? <div className="text-center p-12 text-gray-500">Brak danych z gier Cash dla wybranych filtrów.</div> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col h-96">
            <h3 className="text-lg font-bold text-gray-800 mb-4 shrink-0">Wykres zysków w czasie (Cash)</h3>
            <div className="flex-1 w-full relative">
              <Suspense fallback={<div className="p-4 text-sm text-slate-500">Ładowanie wykresu…</div>}>
                <WalletTimelineChart timeline={walletData.timeline}/>
              </Suspense>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col h-96">
            <h3 className="text-lg font-bold text-gray-800 mb-6 shrink-0">Skuteczność wg. pozycji {onlyFlop ? '(tylko flopy)' : '(Cash)'}</h3>
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar flex flex-col gap-3">
              {walletData.positionFrequencyData.map((item) => {
                const widthPercent = (item.total / walletData.maxPosHands) * 100;
                const winPercent = item.total > 0 ? (item.wins / item.total) * 100 : 0;
                return (
                  <div key={item.position} className="flex items-center gap-4">
                    <div className={`w-16 h-10 flex items-center justify-center font-black rounded-lg border shadow-sm text-xs text-white ${getWinRateColor(winPercent)}`}>{item.position}</div>
                    <div className="flex-1 flex items-center bg-slate-50 rounded-lg">
                      <div className="h-8 rounded-lg flex overflow-hidden shadow-inner border border-gray-200 relative" style={{ width: `${widthPercent}%`, minWidth: '140px' }}>
                        <div className="bg-emerald-500 h-full" style={{ width: `${winPercent}%` }} />
                        <div className="bg-rose-500 h-full" style={{ width: `${100 - winPercent}%` }} />
                        <div className="absolute inset-0 flex items-center px-3 text-[11px] font-black text-white z-10">{item.wins} W / {item.total} ({winPercent.toFixed(1)}%)</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
