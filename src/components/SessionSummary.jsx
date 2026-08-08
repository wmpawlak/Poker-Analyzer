import { useId } from 'react';
import { Info, Layers3, TrendingUp } from 'lucide-react';

const PERCENTAGE_DEFINITIONS = {
  vpip: {
    label: 'VPIP',
    definition: 'Jak często Hero dobrowolnie dokłada żetony do puli przed flopem.',
    formula: 'ręce z dobrowolnym call/bet/raise ÷ wszystkie ręce',
  },
  pfr: {
    label: 'PFR',
    definition: 'Jak często Hero podbija przed flopem.',
    formula: 'ręce z raise’em preflop ÷ wszystkie ręce',
  },
  threeBet: {
    label: '3-bet',
    definition: 'Jak często Hero przebija pierwsze podbicie preflop.',
    formula: '3-bety ÷ okazje do 3-betu',
  },
  foldToThreeBet: {
    label: 'Fold do 3-betu',
    definition: 'Jak często Hero pasuje po swoim otwarciu, gdy przeciwnik zagrywa 3-bet.',
    formula: 'foldy do 3-betu ÷ otrzymane 3-bety',
  },
  fourBet: {
    label: '4-bet',
    definition: 'Jak często Hero odpowiada 4-betem na 3-bet przeciwnika.',
    formula: '4-bety ÷ okazje do 4-betu',
  },
  cBet: {
    label: 'C-bet',
    definition: 'Jak często Hero kontynuuje agresję na flopie po przejęciu inicjatywy preflop.',
    formula: 'c-bety na flopie ÷ okazje do c-betu',
  },
  cBetSrp: {
    label: 'C-bet SRP',
    definition: 'C-bet na flopie wyłącznie w pulach z jednym podbiciem preflop.',
    formula: 'c-bety w SRP ÷ okazje do c-betu w SRP',
  },
  foldToCBet: {
    label: 'Fold do C-betu',
    definition: 'Jak często Hero pasuje bezpośrednio na flopowy c-bet agresora preflop.',
    formula: 'foldy do c-betu ÷ otrzymane c-bety',
  },
  wtsd: {
    label: 'WTSD',
    definition: 'Jak często Hero dochodzi do showdownu po zobaczeniu flopa.',
    formula: 'showdowny ÷ ręce, w których Hero zobaczył flop',
  },
  wsd: {
    label: 'W$SD',
    definition: 'Jak często Hero wygrywa rozdanie po faktycznym dojściu do showdownu.',
    formula: 'wygrane showdowny ÷ wszystkie showdowny Hero',
  },
};

const RFI_POSITIONS = [
  ['CO', 'CO'],
  ['BTN', 'BTN'],
  ['SB', 'SB'],
  ['BTN/SB', 'BTN/SB HU'],
];

const STREETS = [
  ['total', 'Łącznie'],
  ['flop', 'Flop'],
  ['turn', 'Turn'],
  ['river', 'River'],
];

const formatNumber = (value, maximumFractionDigits = 2) => Number(value).toLocaleString('pl-PL', {
  maximumFractionDigits,
});

const formatPercentage = (metric) => Number.isFinite(metric?.value)
  ? `${formatNumber(metric.value, 1)}%`
  : metric?.value ?? '—';

const formatFactor = (metric) => Number.isFinite(metric?.value)
  ? formatNumber(metric.value, 2)
  : metric?.value ?? '—';

const formatProfit = (value, gameType) => {
  const number = Number(value) || 0;
  const sign = number > 0 ? '+' : '';
  if (gameType === 'cash') return `${sign}₮${formatNumber(number, 2)}`;
  return `${sign}${formatNumber(number, 2)} żetonów`;
};

const getPercentageSample = (metric) => `${metric?.executions ?? 0} / ${metric?.opportunities ?? 0}`;

const formatWinrate = (metrics) => Number.isFinite(metrics?.winrate?.value)
  ? `${formatNumber(metrics.winrate.value, 2)} ${metrics.winrate.unit}`
  : '—';

const MetricCard = ({ label, value, definition, formula, sample, accent }) => {
  const tooltipId = useId();
  const accentClass = accent === 'amber' ? 'text-amber-700' : 'text-indigo-700';

  return (
    <div className="group relative min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition-colors hover:border-slate-300">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-black uppercase leading-tight tracking-wide text-slate-500" title={label}>{label}</span>
        <button
          type="button"
          aria-label={`Informacje o statystyce ${label}`}
          aria-describedby={tooltipId}
          className="shrink-0 rounded text-slate-400 outline-none transition-colors hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
        >
          <Info size={13}/>
        </button>
      </div>
      <div className={`mt-1 break-words font-mono text-base font-black leading-tight tracking-tight sm:text-lg ${accentClass}`} title={String(value)}>{value}</div>
      <div
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute inset-x-0 top-[calc(100%+0.4rem)] z-40 rounded-lg bg-slate-900 p-3 text-left text-[11px] leading-relaxed text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <p className="font-semibold">{definition}</p>
        <p className="mt-1 text-slate-300"><span className="font-bold text-white">Wzór:</span> {formula}</p>
        <p className="mt-1 text-slate-300"><span className="font-bold text-white">Próba:</span> {sample}</p>
      </div>
    </div>
  );
};

const SummarySection = ({ title, description, children }) => (
  <section aria-label={title}>
    <div className="mb-2">
      <h4 className="text-xs font-black uppercase tracking-[0.12em] text-slate-700">{title}</h4>
      <p className="mt-0.5 text-[10px] text-slate-400">{description}</p>
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">{children}</div>
  </section>
);

const PercentageCard = ({ metricId, metric, label, definition, formula, accent }) => {
  const defaults = PERCENTAGE_DEFINITIONS[metricId];
  return (
    <MetricCard
      label={label || defaults.label}
      value={formatPercentage(metric)}
      definition={definition || defaults.definition}
      formula={formula || defaults.formula}
      sample={getPercentageSample(metric)}
      accent={accent}
    />
  );
};

const AggressionCard = ({ kind, scope, scopeLabel, metric, accent }) => {
  const isFactor = kind === 'AF';
  return (
    <MetricCard
      label={`${kind} ${scopeLabel}`}
      value={isFactor ? formatFactor(metric) : formatPercentage(metric)}
      definition={isFactor
        ? `Współczynnik agresji postflop: ${scopeLabel.toLowerCase()}.`
        : `Odsetek agresywnych decyzji postflop: ${scopeLabel.toLowerCase()}.`}
      formula={isFactor
        ? '(bety + raise’y) ÷ calle'
        : '(bety + raise’y) ÷ (bety + raise’y + calle)'}
      sample={isFactor
        ? `${metric?.betsRaises ?? 0} agresywnych / ${metric?.calls ?? 0} calli`
        : `${metric?.betsRaises ?? 0} agresywnych / ${(metric?.betsRaises ?? 0) + (metric?.calls ?? 0)} decyzji`}
      accent={accent}
      key={`${kind}-${scope}`}
    />
  );
};

const ResultBreakdownCards = ({ label, metrics, gameType, accent }) => (
  <>
    <MetricCard
      label={`${label} — wynik netto`}
      value={formatProfit(metrics?.totalProfit, gameType)}
      definition={`Łączny rezultat Hero w rozdaniach ${label}.`}
      formula="suma wyniku netto ze wszystkich rozdań"
      sample={`${metrics?.hands ?? 0} rozdań`}
      accent={accent}
    />
    <MetricCard
      label={`${label} — winrate`}
      value={formatWinrate(metrics)}
      definition={gameType === 'cash'
        ? 'Wynik Cash przeliczony na duże blindy na 100 rozdań.'
        : 'Wynik turniejowy przeliczony na żetony na 100 rozdań.'}
      formula={gameType === 'cash'
        ? 'suma wyniku w BB ÷ liczba rąk × 100'
        : 'suma wyniku w żetonach ÷ liczba rąk × 100'}
      sample={`${metrics?.winrate?.numerator ?? '—'} / ${metrics?.winrate?.denominator ?? 0}`}
      accent={accent}
    />
  </>
);

export const SessionSummary = ({
  metrics,
  accent = 'indigo',
  title = 'Podsumowanie sesji',
  description = 'Statystyki Hero dla wszystkich rozdań w wybranej sesji.',
  resultBreakdown = null,
  analysisPanel = null,
}) => {
  if (!metrics) return null;

  const profile = metrics.playerProfile;
  const profileLabel = profile?.style?.label || profile?.reliability?.label || 'Za mała próba';
  const profileDescription = profile?.style?.description
    || `Do klasyfikacji stylu potrzeba co najmniej ${profile?.reliability?.minimumHands ?? 30} rozdań.`;
  const isAmber = accent === 'amber';
  const profileClasses = isAmber
    ? 'border-amber-200 bg-amber-50 text-amber-950'
    : 'border-indigo-200 bg-indigo-50 text-indigo-950';
  const badgeClasses = isAmber
    ? 'border-amber-200 bg-white text-amber-800'
    : 'border-indigo-200 bg-white text-indigo-800';
  const winrate = formatWinrate(metrics);

  return (
    <div data-testid="session-summary" className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp size={18} className={isAmber ? 'text-amber-600' : 'text-indigo-600'}/>
            <h3 className="text-base font-black text-slate-900">{title}</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
          <Layers3 size={13}/>{metrics.hands} rozdań
        </div>
      </div>

      <div className={`mt-4 rounded-xl border p-3 ${profileClasses}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-[0.12em] opacity-60">Profil gry</span>
          <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide">{profile?.reliability?.label}</span>
          {profile?.badges?.map((badge) => (
            <span key={badge.id} title={badge.description} aria-label={`${badge.label}: ${badge.description}`} className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${badgeClasses}`}>{badge.label}</span>
          ))}
        </div>
        <p className="mt-1.5 text-sm font-black">{profileLabel}</p>
        <p className="mt-1 text-xs leading-relaxed opacity-75">{profileDescription}</p>
      </div>

      {analysisPanel ? <div className="mt-4">{analysisPanel}</div> : null}

      <div className="mt-5 grid grid-cols-1 gap-6">
        <SummarySection title="Preflop" description="Selekcja rąk, inicjatywa i reakcje na przebicia.">
          <PercentageCard metricId="vpip" metric={metrics.preflop.vpip} accent={accent}/>
          <PercentageCard metricId="pfr" metric={metrics.preflop.pfr} accent={accent}/>
          <PercentageCard metricId="threeBet" metric={metrics.preflop.threeBet} accent={accent}/>
          <PercentageCard metricId="foldToThreeBet" metric={metrics.preflop.foldToThreeBet} accent={accent}/>
          <PercentageCard metricId="fourBet" metric={metrics.preflop.fourBet} accent={accent}/>
          {RFI_POSITIONS.map(([position, label]) => (
            <PercentageCard
              key={position}
              metricId="vpip"
              label={`RFI ${label}`}
              metric={metrics.preflop.rfiByPosition[position]}
              definition={`Jak często Hero otwiera podbiciem jako pierwszy z pozycji ${label}.`}
              formula={`open raise z ${label} ÷ okazje do open raise z ${label}`}
              accent={accent}
            />
          ))}
        </SummarySection>

        <SummarySection title="Postflop" description="C-bety oraz agresja łącznie i na każdej ulicy.">
          <PercentageCard metricId="cBet" metric={metrics.postflop.cBet} accent={accent}/>
          <PercentageCard metricId="cBetSrp" metric={metrics.postflop.cBetSrp} accent={accent}/>
          <PercentageCard metricId="foldToCBet" metric={metrics.postflop.foldToCBet} accent={accent}/>
          {STREETS.map(([scope, scopeLabel]) => (
            <AggressionCard key={`AF-${scope}`} kind="AF" scope={scope} scopeLabel={scopeLabel} metric={metrics.postflop.af[scope]} accent={accent}/>
          ))}
          {STREETS.map(([scope, scopeLabel]) => (
            <AggressionCard key={`AFq-${scope}`} kind="AFq" scope={scope} scopeLabel={scopeLabel} metric={metrics.postflop.afq[scope]} accent={accent}/>
          ))}
        </SummarySection>

        <SummarySection title="Wynik" description="Showdown, rezultat sesji i wynik na 100 rozdań.">
          <PercentageCard metricId="wtsd" metric={metrics.showdown.wtsd} accent={accent}/>
          <PercentageCard metricId="wsd" metric={metrics.showdown.wsd} accent={accent}/>
          {resultBreakdown ? (
            <>
              <ResultBreakdownCards
                label="Cash"
                metrics={resultBreakdown.cash}
                gameType="cash"
                accent={accent}
              />
              <ResultBreakdownCards
                label="Turnieje"
                metrics={resultBreakdown.tournament}
                gameType="tournament"
                accent={accent}
              />
            </>
          ) : null}
          <MetricCard
            label="Hands"
            value={formatNumber(metrics.hands, 0)}
            definition="Liczba prawdziwych rozdań w sesji; wpisy rebuy nie są rozdaniami."
            formula="liczba rozdań po wykluczeniu syntetycznych rebuy"
            sample={`${metrics.hands} rozdań`}
            accent={accent}
          />
          <MetricCard
            label="Wynik netto"
            value={formatProfit(metrics.totalProfit, metrics.gameType)}
            definition="Łączny rezultat Hero w wybranej sesji."
            formula="suma wyniku netto ze wszystkich rozdań"
            sample={`${metrics.hands} rozdań`}
            accent={accent}
          />
          <MetricCard
            label="Winrate"
            value={winrate}
            definition={metrics.gameType === 'cash'
              ? 'Wynik Cash przeliczony na duże blindy na 100 rozdań.'
              : 'Wynik turniejowy przeliczony na żetony na 100 rozdań.'}
            formula={metrics.gameType === 'cash'
              ? 'suma wyniku w BB ÷ liczba rąk × 100'
              : 'suma wyniku w żetonach ÷ liczba rąk × 100'}
            sample={`${metrics.winrate?.numerator ?? '—'} / ${metrics.winrate?.denominator ?? 0}`}
            accent={accent}
          />
        </SummarySection>
      </div>
    </div>
  );
};
