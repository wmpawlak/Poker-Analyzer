import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Ellipsis, Equal } from 'lucide-react';

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const POSITIONS = ['UTG', 'HJ', 'BTN', 'SB'];
const RANGE_TRACK = 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)';
const RANGE_IMAGE_CELL_SIZE = 160;
const RANGE_IMAGE_HEADER_SIZE = 96;
const RANGE_IMAGE_PADDING = 96;
const RANGE_IMAGE_TITLE_HEIGHT = 150;
const RANGE_WEB_CELL_SIZE = 56;
// Wspólne ustawienia fontów strony i eksportu. Zmień te wartości, aby skalować oba widoki.
const RANGE_HAND_FONT_SIZE = 21;
const RANGE_POSITION_FONT_SIZE = 9;
const RANGE_IMAGE_SCALE = RANGE_IMAGE_CELL_SIZE / RANGE_WEB_CELL_SIZE;
const RANGE_IMAGE_WIDTH = (RANGE_IMAGE_PADDING * 2) + RANGE_IMAGE_HEADER_SIZE + (RANKS.length * RANGE_IMAGE_CELL_SIZE);
const RANGE_IMAGE_HEIGHT = RANGE_IMAGE_TITLE_HEIGHT + (RANGE_IMAGE_PADDING * 2) + RANGE_IMAGE_HEADER_SIZE + (RANKS.length * RANGE_IMAGE_CELL_SIZE);
const RANGE_LEGEND = [
  { label: 'Fold', color: '#22c55e' },
  { label: 'Call', color: '#eab308' },
  { label: 'Raise', color: '#ef4444' },
];

const HANDS = RANKS.flatMap((rowRank, rowIndex) => RANKS.map((columnRank, columnIndex) => {
  const notation = rowIndex === columnIndex
    ? `${rowRank}${columnRank}`
    : rowIndex < columnIndex
      ? `${rowRank}${columnRank}s`
      : `${columnRank}${rowRank}o`;
  return { notation };
}));

const createHandsWithValue = (value) => Object.fromEntries(HANDS.map(({ notation }) => (
  [notation, Object.fromEntries(POSITIONS.map((position) => [position, value]))]
)));

const createDefaultHands = () => createHandsWithValue(0);

const isIntegerPercent = (value) => Number.isInteger(value) && value >= 0 && value <= 100;
const hasCompleteHands = (hands) => hands && typeof hands === 'object'
  && HANDS.every(({ notation }) => POSITIONS.every((position) => isIntegerPercent(hands[notation]?.[position])));

const mixColor = (start, end, progress) => start.map((channel, index) => (
  Math.round(channel + ((end[index] - channel) * progress))
));

const getAggressionColor = (value) => {
  const normalizedValue = Math.min(100, Math.max(0, value));
  const [start, end, progress] = normalizedValue <= 50
    ? [[34, 197, 94], [234, 179, 8], normalizedValue / 50]
    : [[234, 179, 8], [239, 68, 68], (normalizedValue - 50) / 50];

  return `rgb(${mixColor(start, end, progress).join(', ')})`;
};

const svgText = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const createRangeMatrixSvg = (hands, versionName = 'Open-raise') => {
  const matrixStartX = RANGE_IMAGE_PADDING + RANGE_IMAGE_HEADER_SIZE;
  const matrixStartY = RANGE_IMAGE_TITLE_HEIGHT + RANGE_IMAGE_PADDING + RANGE_IMAGE_HEADER_SIZE;
  const halfCell = RANGE_IMAGE_CELL_SIZE / 2;
  const positionOffsets = [
    [0, 0],
    [halfCell, 0],
    [0, halfCell],
    [halfCell, halfCell],
  ];
  const columnHeaders = RANKS.map((rank, columnIndex) => (
    `<text x="${matrixStartX + (columnIndex * RANGE_IMAGE_CELL_SIZE) + halfCell}" y="${matrixStartY - 36}" class="header">${rank}</text>`
  )).join('');
  const rowHeaders = RANKS.map((rank, rowIndex) => (
    `<text x="${matrixStartX - 48}" y="${matrixStartY + (rowIndex * RANGE_IMAGE_CELL_SIZE) + 102}" class="header">${rank}</text>`
  )).join('');
  const legend = RANGE_LEGEND.map(({ label, color }, index) => {
    const x = RANGE_IMAGE_PADDING + (index * 220);
    return `<rect x="${x}" y="98" width="28" height="28" rx="6" fill="${color}" />
      <text x="${x + 40}" y="120" class="legend">${label}</text>`;
  }).join('');
  const cells = HANDS.map(({ notation }, index) => {
    const rowIndex = Math.floor(index / RANKS.length);
    const columnIndex = index % RANKS.length;
    const x = matrixStartX + (columnIndex * RANGE_IMAGE_CELL_SIZE);
    const y = matrixStartY + (rowIndex * RANGE_IMAGE_CELL_SIZE);
    const quadrants = POSITIONS.map((position, positionIndex) => {
      const [offsetX, offsetY] = positionOffsets[positionIndex];
      return `<rect x="${x + offsetX}" y="${y + offsetY}" width="${halfCell}" height="${halfCell}" fill="${getAggressionColor(hands[notation][position])}" class="quadrant" />
        <text x="${x + offsetX + (halfCell / 2)}" y="${y + offsetY + 48}" class="position">${position}</text>`;
    }).join('');
    return `<g>${quadrants}<rect x="${x}" y="${y}" width="${RANGE_IMAGE_CELL_SIZE}" height="${RANGE_IMAGE_CELL_SIZE}" class="cell" />
      <text x="${x + halfCell}" y="${y + 98}" class="hand">${svgText(notation)}</text></g>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${RANGE_IMAGE_WIDTH}" height="${RANGE_IMAGE_HEIGHT}" viewBox="0 0 ${RANGE_IMAGE_WIDTH} ${RANGE_IMAGE_HEIGHT}">
    <style>
      .header { fill: #0f172a; font: 900 48px Arial, Helvetica, sans-serif; text-anchor: middle; dominant-baseline: middle; }
      .position { fill: #0f172a; font: 900 ${Math.round(RANGE_POSITION_FONT_SIZE * RANGE_IMAGE_SCALE)}px Arial, Helvetica, sans-serif; text-anchor: middle; dominant-baseline: middle; }
      .hand { fill: #1d4ed8; font: 900 ${Math.round(RANGE_HAND_FONT_SIZE * RANGE_IMAGE_SCALE)}px Arial, Helvetica, sans-serif; text-anchor: middle; dominant-baseline: middle; paint-order: stroke; stroke: rgba(255,255,255,.72); stroke-width: 2px; }
      .legend { fill: #334155; font: 700 24px Arial, Helvetica, sans-serif; dominant-baseline: middle; }
      .cell { fill: none; stroke: #0f172a; stroke-width: 4px; }
      .quadrant { stroke: rgba(15,23,42,.25); stroke-width: 2px; }
    </style>
    <rect width="100%" height="100%" fill="#ffffff" />
    <text x="${RANGE_IMAGE_PADDING}" y="68" fill="#0f172a" font-family="Arial, Helvetica, sans-serif" font-size="56" font-weight="900">Matryca zakresów preflop — ${svgText(versionName || 'Open-raise')}</text>
    ${legend}${columnHeaders}${rowHeaders}${cells}
  </svg>`;
};

const downloadRangeMatrixImage = async (hands, versionName) => {
  const svgBlob = new Blob([createRangeMatrixSvg(hands, versionName)], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Nie udało się przygotować obrazu matrycy.'));
      image.src = svgUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = RANGE_IMAGE_WIDTH;
    canvas.height = RANGE_IMAGE_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Przeglądarka nie obsługuje eksportu PNG.');
    context.drawImage(image, 0, 0);
    const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!pngBlob) throw new Error('Nie udało się utworzyć pliku PNG.');
    const downloadUrl = URL.createObjectURL(pngBlob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `matryca-zakresow-${new Date().toISOString().slice(0, 10)}.png`;
    link.click();
    URL.revokeObjectURL(downloadUrl);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
};

const readResponse = async (response, fallbackMessage) => {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`${fallbackMessage} Serwer API nie zwrócił poprawnej odpowiedzi.`);
  }
  const data = await response.json().catch(() => null);
  if (!data) throw new Error(`${fallbackMessage} Serwer API zwrócił nieprawidłowe dane.`);
  if (!response.ok) throw new Error(data.error || fallbackMessage);
  return data;
};

const rangeSetupApi = {
  getPreflopSetup: async () => readResponse(
    await fetch('/api/ranges/preflop', { cache: 'no-store' }),
    'Nie udało się odczytać zapisanej macierzy zakresów.',
  ),
  activatePreflopVersion: async (versionId) => readResponse(
    await fetch('/api/ranges/preflop/active', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId }),
    }),
    'Nie udało się przełączyć wersji zakresów.',
  ),
  renamePreflopVersion: async (versionId, name) => readResponse(
    await fetch(`/api/ranges/preflop/versions/${encodeURIComponent(versionId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
    'Nie udało się zmienić nazwy wersji zakresów.',
  ),
  copyPreflopVersion: async (versionId) => readResponse(
    await fetch(`/api/ranges/preflop/versions/${encodeURIComponent(versionId)}/copy`, {
      method: 'POST',
    }),
    'Nie udało się skopiować wersji zakresów.',
  ),
  deletePreflopVersion: async (versionId) => readResponse(
    await fetch(`/api/ranges/preflop/versions/${encodeURIComponent(versionId)}`, {
      method: 'DELETE',
    }),
    'Nie udało się usunąć wersji zakresów.',
  ),
  savePreflopSetup: async (hands) => readResponse(
    await fetch('/api/ranges/preflop', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hands }),
    }),
    'Nie udało się zapisać macierzy zakresów.',
  ),
};

export const RangesView = ({ api = rangeSetupApi }) => {
  const [hands, setHands] = useState(createDefaultHands);
  const [selectedHand, setSelectedHand] = useState('AA');
  const [versions, setVersions] = useState([]);
  const [activeVersionId, setActiveVersionId] = useState('');
  const [versionName, setVersionName] = useState('');
  const [versionActionState, setVersionActionState] = useState('idle');
  const [loadState, setLoadState] = useState('loading');
  const [saveState, setSaveState] = useState('idle');
  const [message, setMessage] = useState('');
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const [exportState, setExportState] = useState('idle');

  const applyVersionResponse = ({ setup, versions: nextVersions, activeVersionId: nextActiveVersionId } = {}) => {
    if (setup?.hands && hasCompleteHands(setup.hands)) setHands(setup.hands);

    const resolvedVersions = Array.isArray(nextVersions) ? nextVersions : versions;
    if (Array.isArray(nextVersions)) setVersions(nextVersions);

    const resolvedActiveVersionId = nextActiveVersionId || setup?.id || activeVersionId;
    if (resolvedActiveVersionId) setActiveVersionId(resolvedActiveVersionId);

    const matchingVersion = resolvedVersions.find((version) => version.id === resolvedActiveVersionId);
    const resolvedName = setup?.name || matchingVersion?.name;
    if (resolvedName) setVersionName(resolvedName);
  };

  useEffect(() => {
    let cancelled = false;
    api.getPreflopSetup()
      .then(({ setup, versions: loadedVersions, activeVersionId: loadedActiveVersionId }) => {
        if (cancelled) return;
        if (setup?.hands && hasCompleteHands(setup.hands)) setHands(setup.hands);
        if (Array.isArray(loadedVersions)) setVersions(loadedVersions);
        const resolvedActiveVersionId = loadedActiveVersionId || setup?.id || '';
        if (resolvedActiveVersionId) setActiveVersionId(resolvedActiveVersionId);
        const matchingVersion = loadedVersions?.find((version) => version.id === resolvedActiveVersionId);
        const resolvedName = setup?.name || matchingVersion?.name;
        if (resolvedName) setVersionName(resolvedName);
        setLoadState('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadState('failed');
        setMessage(error.message);
      });
    return () => { cancelled = true; };
  }, [api]);

  const switchVersion = async (event) => {
    const nextVersionId = event.target.value;
    if (!nextVersionId || nextVersionId === activeVersionId || typeof api.activatePreflopVersion !== 'function') return;
    setVersionActionState('switching');
    setMessage('');
    try {
      const state = await api.activatePreflopVersion(nextVersionId);
      applyVersionResponse(state);
      setVersionActionState('idle');
      setMessage('Wczytano wybraną wersję zakresów.');
    } catch (error) {
      setVersionActionState('idle');
      setMessage(error.message);
    }
  };

  const commitVersionName = async (event) => {
    const rawName = typeof event?.currentTarget?.value === 'string' ? event.currentTarget.value : versionName;
    const nextName = rawName.trim();
    const currentVersion = versions.find((version) => version.id === activeVersionId);
    const currentName = currentVersion?.name || '';
    if (!activeVersionId || typeof api.renamePreflopVersion !== 'function' || nextName === currentName) {
      if (!nextName && currentName) setVersionName(currentName);
      return;
    }
    if (!nextName) {
      setVersionName(currentName);
      setMessage('Nazwa wersji zakresów nie może być pusta.');
      return;
    }
    setVersionActionState('renaming');
    setMessage('');
    try {
      const state = await api.renamePreflopVersion(activeVersionId, nextName);
      applyVersionResponse(state);
      setVersions((currentVersions) => currentVersions.map((version) => (
        version.id === activeVersionId ? { ...version, name: nextName } : version
      )));
      setVersionName(nextName);
      setVersionActionState('idle');
      setMessage('Zmieniono nazwę wersji zakresów.');
    } catch (error) {
      setVersionActionState('idle');
      setMessage(error.message);
    }
  };

  const copyVersion = async () => {
    if (!activeVersionId || typeof api.copyPreflopVersion !== 'function') return;
    setVersionActionState('copying');
    setMessage('');
    try {
      const state = await api.copyPreflopVersion(activeVersionId);
      applyVersionResponse(state);
      setVersionActionState('idle');
      setMessage('Utworzono kopię wersji zakresów.');
    } catch (error) {
      setVersionActionState('idle');
      setMessage(error.message);
    }
  };

  const deleteVersion = async () => {
    if (versions.length <= 1 || !activeVersionId || typeof api.deletePreflopVersion !== 'function') return;
    if (typeof window !== 'undefined' && typeof window.confirm === 'function'
      && !window.confirm(`Czy na pewno usunąć wersję „${versionName}”?`)) return;
    setVersionActionState('deleting');
    setMessage('');
    try {
      const state = await api.deletePreflopVersion(activeVersionId);
      applyVersionResponse(state);
      setVersionActionState('idle');
      setMessage('Usunięto wersję zakresów.');
    } catch (error) {
      setVersionActionState('idle');
      setMessage(error.message);
    }
  };

  const updateSelectedPosition = (position, value) => {
    setHands((currentHands) => ({
      ...currentHands,
      [selectedHand]: {
        ...currentHands[selectedHand],
        [position]: Number(value),
      },
    }));
    setSaveState('idle');
    setMessage('');
  };

  const resetToDefaults = () => {
    setHands(createDefaultHands());
    setSaveState('idle');
    setMessage('Przywrócono domyślne wartości Fold. Zapisz, aby utrwalić zmianę.');
  };

  const setSelectedHandPositions = (value, action) => {
    setHands((currentHands) => ({
      ...currentHands,
      [selectedHand]: Object.fromEntries(POSITIONS.map((position) => [position, value])),
    }));
    setSaveState('idle');
    setMessage(`Ustawiono rękę ${selectedHand} na ${action}. Zapisz, aby utrwalić zmianę.`);
  };

  const saveSetup = async () => {
    setSaveState('saving');
    setMessage('');
    try {
      await api.savePreflopSetup(hands);
      setSaveState('saved');
      setMessage('Zapisano macierz zakresów w bazie danych.');
    } catch (error) {
      setSaveState('failed');
      setMessage(error.message);
    }
  };

  const exportImage = async () => {
    setExportState('exporting');
    setMessage('');
    try {
      await downloadRangeMatrixImage(hands, versionName);
      setMessage('Pobrano obraz matrycy PNG w wysokiej rozdzielczości.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setExportState('idle');
    }
  };

  const selectedValues = hands[selectedHand];

  return (
    <section className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.3em] text-indigo-600">Zakresy preflop</p>
          <h3 className="mt-1 text-xl font-black text-slate-950" data-testid="range-page-title">{versionName || 'Matryca 169 rąk'}</h3>
        </div>
        {loadState === 'loading' && <p className="text-xs font-semibold text-slate-500">Wczytywanie zapisanego setupu…</p>}
      </div>

      <div aria-label="Legenda kolorów" className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" data-testid="range-color-legend">
        {RANGE_LEGEND.map(({ label, color }) => (
          <span className="inline-flex items-center gap-2 text-xs font-black text-slate-700" data-testid={`range-legend-${label.toLowerCase()}`} key={label}>
            <span aria-hidden="true" className="h-3 w-3 rounded-sm border border-slate-900/10" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
      </div>

      {versions.length > 0 && (
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3" data-testid="range-version-controls">
          <div className="min-w-56 flex-1">
            <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700" htmlFor="range-version-name">Aktywna wersja</label>
            <h4 className="text-xl font-black text-slate-950">
              <input
                aria-label="Nazwa aktywnej wersji"
                className="w-full border-0 border-b-2 border-indigo-300 bg-transparent px-0 py-1 text-xl font-black text-slate-950 outline-none transition focus:border-indigo-700 focus:ring-0"
                data-testid="range-version-name"
                id="range-version-name"
                onBlur={commitVersionName}
                onInput={(event) => setVersionName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitVersionName(event);
                  }
                }}
                value={versionName}
              />
            </h4>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="range-version-select">Wybierz wersję zakresów</label>
            <select
              aria-label="Wybierz wersję zakresów"
              className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
              data-testid="range-version-select"
              disabled={versionActionState === 'switching'}
              id="range-version-select"
              onChange={switchVersion}
              value={activeVersionId}
            >
              {versions.map((version) => <option key={version.id} value={version.id}>{version.name}</option>)}
            </select>
            <button
              aria-label="Kopiuj aktywną wersję"
              className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-100 disabled:cursor-wait disabled:opacity-60"
              data-testid="copy-range-version"
              disabled={versionActionState !== 'idle'}
              onClick={copyVersion}
              type="button"
            >
              Kopiuj
            </button>
            <button
              aria-label="Usuń aktywną wersję"
              className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="delete-range-version"
              disabled={versions.length <= 1 || versionActionState !== 'idle'}
              onClick={deleteVersion}
              type="button"
            >
              Usuń
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-2">
        <div className="grid w-max gap-px" style={{ gridTemplateColumns: '1.25rem repeat(13, 3.5rem)' }}>
          <div aria-hidden="true" />
          {RANKS.map((rank) => (
            <div className="flex h-5 items-center justify-center text-xs font-black text-slate-200" key={`column-${rank}`}>{rank}</div>
          ))}
          {RANKS.map((rowRank, rowIndex) => (
            <div className="contents" key={`row-${rowRank}`}>
              <div className="flex w-5 items-center justify-center text-xs font-black text-slate-200">{rowRank}</div>
              {HANDS.slice(rowIndex * RANKS.length, (rowIndex + 1) * RANKS.length).map(({ notation }) => (
                <button
                  aria-label={`Ustawienia ręki ${notation}`}
                  aria-pressed={selectedHand === notation}
                  className={`relative grid h-14 w-14 grid-cols-2 grid-rows-2 overflow-hidden rounded-sm border border-slate-950/70 font-black text-slate-950 transition-transform hover:z-20 hover:scale-110 focus:z-20 focus:outline-none focus:ring-2 focus:ring-blue-400 ${selectedHand === notation ? 'z-10 ring-2 ring-blue-500 ring-offset-1 ring-offset-slate-950' : ''}`}
                  data-testid={`range-hand-${notation}`}
                  key={notation}
                  onClick={() => setSelectedHand(notation)}
                  type="button"
                >
                  {POSITIONS.map((position) => (
                    <span className="flex items-center justify-center border border-slate-950/25" key={position} style={{ backgroundColor: getAggressionColor(hands[notation][position]), fontSize: `${RANGE_POSITION_FONT_SIZE}px` }}>
                      {position}
                    </span>
                  ))}
                  <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center font-black tracking-tighter text-blue-700/90 drop-shadow-[0_1px_0_rgba(255,255,255,0.65)]" style={{ fontSize: `${RANGE_HAND_FONT_SIZE}px` }}>
                    {notation}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <section aria-label="Panel ustawień wybranej ręki" className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Wybrana ręka</p>
            <h4 className="text-2xl font-black text-blue-700" data-testid="selected-range-hand">{selectedHand}</h4>
          </div>
          <div className="flex gap-2">
            <button aria-label={`Ustaw rękę ${selectedHand} na Fold`} className="rounded-lg border border-green-200 bg-green-50 p-2 text-green-700 hover:bg-green-100" data-testid="set-hand-fold" onClick={() => setSelectedHandPositions(0, 'Fold')} title="Fold: ustaw cztery pozycje wybranej ręki na 0" type="button">
              <ChevronDown aria-hidden="true" size={20} strokeWidth={3} />
            </button>
            <button aria-label={`Ustaw rękę ${selectedHand} na Call`} className="rounded-lg border border-yellow-200 bg-yellow-50 p-2 text-yellow-700 hover:bg-yellow-100" data-testid="set-hand-call" onClick={() => setSelectedHandPositions(50, 'Call')} title="Call: ustaw cztery pozycje wybranej ręki na 50" type="button">
              <Equal aria-hidden="true" size={20} strokeWidth={3} />
            </button>
            <button aria-label={`Ustaw rękę ${selectedHand} na Raise`} className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-700 hover:bg-red-100" data-testid="set-hand-raise" onClick={() => setSelectedHandPositions(100, 'Raise')} title="Raise: ustaw cztery pozycje wybranej ręki na 100" type="button">
              <ChevronUp aria-hidden="true" size={20} strokeWidth={3} />
            </button>
            <div className="relative">
              <button aria-expanded={isActionsMenuOpen} aria-haspopup="menu" aria-label="Więcej akcji" className="rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-100" data-testid="range-actions-menu" onClick={() => setIsActionsMenuOpen((isOpen) => !isOpen)} title="Więcej akcji" type="button">
                <Ellipsis aria-hidden="true" size={20} strokeWidth={3} />
              </button>
              {isActionsMenuOpen && (
                <div className="absolute right-0 top-full z-20 mt-2 min-w-36 rounded-lg border border-slate-200 bg-white p-1 shadow-lg" role="menu">
                  <button className="w-full rounded-md px-3 py-2 text-left text-sm font-bold text-slate-700 hover:bg-slate-100" data-testid="reset-range-setup" onClick={() => { resetToDefaults(); setIsActionsMenuOpen(false); }} role="menuitem" type="button">Domyślne</button>
                </div>
              )}
            </div>
            <button aria-label="Pobierz matrycę jako PNG" className="rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60" data-testid="download-range-image" disabled={exportState === 'exporting'} onClick={exportImage} title="Pobierz PNG w wysokiej rozdzielczości" type="button">
              <Download aria-hidden="true" size={20} strokeWidth={3} />
            </button>
            <button className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60" data-testid="save-range-setup" disabled={saveState === 'saving'} onClick={saveSetup} type="button">
              {saveState === 'saving' ? 'Zapisywanie…' : 'Zapisz'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {POSITIONS.map((position) => (
            <div className="rounded-lg border border-slate-200 bg-white p-3" key={position}>
              <label className="mb-2 block text-sm font-black text-slate-800" htmlFor={`aggression-${position}`}>
                Agresja {position}
              </label>
              <input
                aria-label={`Agresja ${position} dla ręki ${selectedHand}`}
                className="h-2 w-full cursor-pointer rounded-lg"
                data-testid={`range-slider-${position}`}
                id={`aggression-${position}`}
                max="100"
                min="0"
                onInput={(event) => updateSelectedPosition(position, event.target.value)}
                step="1"
                style={{ background: RANGE_TRACK }}
                type="range"
                value={selectedValues[position]}
              />
              <div aria-hidden="true" className="mt-2 grid grid-cols-3 text-[10px] font-black">
                <span className="text-left text-green-600">Fold</span>
                <span className="text-center text-yellow-600">Call</span>
                <span className="text-right text-red-600">Raise</span>
              </div>
            </div>
          ))}
        </div>

        {message && <p className={`mt-4 text-sm font-semibold ${saveState === 'failed' || loadState === 'failed' ? 'text-red-700' : 'text-slate-600'}`} role={saveState === 'failed' || loadState === 'failed' ? 'alert' : 'status'}>{message}</p>}
      </section>
    </section>
  );
};
