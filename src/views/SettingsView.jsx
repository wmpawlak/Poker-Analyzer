import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  AlertTriangle,
  CheckCircle,
  CircleStop,
  Clock3,
  Database,
  Key,
  Play,
  RefreshCw,
  RotateCcw,
  ScanSearch,
} from 'lucide-react';
import { fetchAiModels, setDefaultAiModel } from '../store/pokerSlice.js';
import * as defaultTrainingApi from '../training/trainingApi.js';
import {
  DEFAULT_TRAINING_REFRESH_SAMPLE_SIZE,
  TRAINING_REFRESH_SAMPLE_SIZES,
} from '../training/trainingTypes.js';

const EXERCISE_ROWS = [
  ['preflop_selection', 'Selekcja preflop'],
  ['preflop_vs_reraise', 'Przeciw 3-betom i reshove’om'],
  ['cbet_barrels', 'C-bet i kolejne baryłki'],
  ['turn_river', 'Decyzje turn/river'],
];

const JOB_LABELS = {
  running: 'W toku',
  stop_requested: 'Zatrzymywanie po bieżącej partii',
  stopped: 'Zatrzymane',
  completed: 'Zakończone',
  failed: 'Błąd',
  superseded: 'Zastąpione nowszym kontraktem',
};

const ACTIVE_JOB_STATUSES = new Set(['running', 'stop_requested']);
const RESUMABLE_JOB_STATUSES = new Set(['stopped', 'failed']);
const POLL_BACKOFF_MS = [2_000, 5_000, 10_000, 30_000];
const asNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const hasRefreshWork = (job) => Boolean(
  job && RESUMABLE_JOB_STATUSES.has(job.status)
    && asNumber(job.processedSpotCount) < asNumber(job.candidateCount),
);
const hasBlockingRefreshWork = (job) => Boolean(
  job && (ACTIVE_JOB_STATUSES.has(job.status) || RESUMABLE_JOB_STATUSES.has(job.status))
    && asNumber(job.processedSpotCount) < asNumber(job.candidateCount),
);
const mergeRefreshJob = (current, job) => ({
  ...current,
  refreshJob: job,
  resumableRefreshJob: hasBlockingRefreshWork(job) ? job : null,
});
const formatDate = (value) => {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString('pl-PL') : 'Jeszcze nie wykonano';
};

const Metric = ({ label, value, note }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
    <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</div>
    <div className="mt-2 break-words text-lg font-black text-slate-800">{value}</div>
    {note && <div className="mt-1 text-xs text-slate-500">{note}</div>}
  </div>
);

const PoolCell = ({ pool, limit, tone }) => {
  const selected = pool?.selected ?? pool?.active;
  return <td className={`px-4 py-3 text-right font-mono font-bold ${tone}`}>
    <div>{asNumber(selected)} / {limit}</div>
    <div className="mt-1 text-[10px] font-medium text-slate-500">gotowe {asNumber(pool?.ready)} · oczekuje {asNumber(pool?.pending)} · lokalnie odrzucone {asNumber(pool?.locallyRejected)}</div>
  </td>;
};

const TrainingPoolTable = ({ pools, limit = 100 }) => (
  <div className="overflow-hidden rounded-xl border border-slate-200">
    <table className="w-full text-left text-xs">
      <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500">
        <tr><th className="px-4 py-3">Tryb</th><th className="px-4 py-3 text-right">Cash</th><th className="px-4 py-3 text-right">Turnieje</th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {EXERCISE_ROWS.map(([id, label]) => (
          <tr key={id}>
            <td className="px-4 py-3 font-bold text-slate-700">{label}</td>
            <PoolCell pool={pools?.[id]?.cash} limit={limit} tone="text-indigo-700"/>
            <PoolCell pool={pools?.[id]?.tournament} limit={limit} tone="text-amber-700"/>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const RefreshJobPanel = ({ job, busy, onStop, onResume }) => {
  if (!job) return null;
  const progress = Math.round(asNumber(job.progress) * 100);
  return (
    <div data-testid="training-refresh-job" className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-wider text-indigo-600">Ostatnie zadanie AI</div>
          <div className="mt-1 text-lg font-black text-slate-800">{JOB_LABELS[job.status] || job.status}</div>
          <div className="mt-1 text-xs text-slate-500">Model: {job.modelId} · kontrakt: {job.contractVersion} · partie do {job.batchSize}</div>
        </div>
        {ACTIVE_JOB_STATUSES.has(job.status) && (
          <button type="button" data-testid="stop-training-refresh" disabled={busy || job.status === 'stop_requested'} onClick={onStop} className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2 text-xs font-black text-rose-700 disabled:opacity-50"><CircleStop size={15}/> Zatrzymaj po partii</button>
        )}
        {RESUMABLE_JOB_STATUSES.has(job.status) && job.processedSpotCount < job.candidateCount && (
          <button type="button" data-testid="resume-training-refresh" disabled={busy} onClick={onResume} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50"><Play size={15}/> Wznów</button>
        )}
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }}/></div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-600">
        <span>{job.processedSpotCount} / {job.candidateCount} spotów · {progress}%</span>
        <span>{job.attemptedRequests} prób AI · {job.successfulRequests} udanych · planowo {job.estimatedRequests} partii · {job.readyKeyCount} gotowych kluczy</span>
      </div>
      {ACTIVE_JOB_STATUSES.has(job.status) && <p className="mt-3 rounded-xl border border-indigo-200 bg-white/70 p-3 text-xs font-bold text-indigo-800">Możesz opuścić tę stronę; analiza działa na serwerze i wróci po restarcie. Po restarcie może zostać ponowiona jedna przerwana partia.</p>}
      {Number(job.recoveryCount) > 0 && <p className="mt-2 text-xs text-slate-600">Odzyskano po restarcie: {job.recoveryCount} · ostatnio {formatDate(job.lastRecoveredAt)}{Number(job.inFlightSpotCount) > 0 ? ` · ponowiona partia: ${job.inFlightSpotCount} spotów` : ''}</p>}
      {job.errors?.length > 0 && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">Ostatni błąd: {job.errors.at(-1)?.message}</div>}
    </div>
  );
};

export const TrainingCollectionSettings = ({
  status,
  selectedModel,
  sampleSize = DEFAULT_TRAINING_REFRESH_SAMPLE_SIZE,
  confirmation,
  busy,
  onSampleSizeChange,
  onScan,
  onRequestRebuild,
  rebuildWarning,
  onCancelRebuild,
  onRebuild,
  onConfirm,
  onCancelConfirmation,
  onStop,
  onResume,
  resetConfirmation,
  onRequestReset,
  onCancelReset,
  onConfirmReset,
}) => {
  const latestJob = status?.refreshJob;
  const resumableJob = status?.resumableRefreshJob || (hasRefreshWork(latestJob) ? latestJob : null);
  const job = resumableJob || latestJob;
  const activeJob = ACTIVE_JOB_STATUSES.has(job?.status) || Boolean(resumableJob);
  const refreshBlocked = activeJob;
  const estimate = confirmation?.estimate;
  return (
    <section data-testid="training-collection-settings" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-bold text-slate-800"><Database className="text-indigo-600"/> Kolekcja ćwiczeń</h3>
          <p className="mt-1 text-xs text-slate-500">Lokalny skan jest bezpłatny. Klucze strategiczne AI powstają dopiero po pokazaniu estymacji i osobnym potwierdzeniu.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2"><label className="flex flex-col gap-1 text-[10px] font-black uppercase tracking-wider text-slate-500">Wielkość próbki<select data-testid="training-sample-size" value={sampleSize} onChange={(event) => onSampleSizeChange(Number(event.target.value))} disabled={busy || refreshBlocked} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-black normal-case tracking-normal text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">{TRAINING_REFRESH_SAMPLE_SIZES.map((size) => <option key={size} value={size}>{size} spotów</option>)}</select></label><button type="button" data-testid="scan-training-collection" disabled={busy || refreshBlocked} onClick={() => onScan(false)} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40">
          {busy === 'scan' ? <><RotateCcw size={17} className="animate-spin"/> Skanowanie…</> : <><ScanSearch size={17}/> Odśwież kolekcję</>}
        </button>
        <button type="button" data-testid="request-training-selection-rebuild" disabled={busy || refreshBlocked} onClick={onRequestRebuild} className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-black text-amber-900 disabled:cursor-not-allowed disabled:opacity-40"><AlertTriangle size={16}/> Przebuduj zestaw</button></div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Ostatni skan" value={formatDate(status?.scanState?.lastScannedAt)}/>
        <Metric label="Rewizja datasetu" value={status?.scanState?.datasetRevision || 'Brak'} note={`Rewizja kolekcji: ${status?.revision ?? 0}`}/>
        <Metric label="Nowi kandydaci" value={asNumber(status?.scanState?.lastResult?.spotsAdded)} note={`${asNumber(status?.scanState?.lastResult?.new)} nowych rozdań`}/>
        <Metric label="Ostatnio użyty model" value={status?.models?.find(({ id }) => id === status?.lastUsedModel)?.name || status?.lastUsedModel || 'Brak'}/>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div>
          <h4 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">Gotowe aktywne pule</h4>
          <TrainingPoolTable pools={status?.pools} limit={status?.selectionState?.limit || 100}/>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">Kolejki i odrzucenia</h4>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <Metric label="Kolejka AI" value={asNumber(status?.queue?.pending)} note="Spoty bez klucza"/>
            <Metric label="Ponowna analiza" value={asNumber(status?.queue?.reanalysis)} note="Nie są oceniane automatycznie"/>
            <Metric label="Odrzucone rozdania" value={asNumber(status?.queue?.rejectedHands)} note="Niespójne lub nieobsługiwane"/>
          </div>
        </div>
      </div>


      <p data-testid="training-refresh-estimate" className="mt-4 text-xs font-bold text-slate-600">Estymacja: {asNumber(status?.refreshEstimate?.candidateCount)} spotów / {asNumber(status?.refreshEstimate?.estimatedRequests)} żądań po {asNumber(status?.refreshEstimate?.batchSize) || 20}.</p>

      {rebuildWarning && (
        <div data-testid="training-selection-rebuild-warning" className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
          <strong>Przebudowanie wymieni stały zestaw spotów przed analizą AI.</strong> Niewybrane migawki pozostaną w kolekcji; zmieni się tylko aktywny zestaw ćwiczeń. Następny krok nadal pokaże osobne potwierdzenie płatnych żądań.
          <div className="mt-4 flex gap-2"><button type="button" data-testid="confirm-training-selection-rebuild" disabled={busy || activeJob} onClick={onRebuild} className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-black text-white disabled:opacity-40">Przebuduj lokalnie</button><button type="button" disabled={busy} onClick={onCancelRebuild} className="rounded-xl border border-rose-300 bg-white px-4 py-2 text-xs font-black text-rose-900">Anuluj</button></div>
        </div>
      )}

      {confirmation && (
        <div data-testid="training-refresh-confirmation" className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="mb-3 text-xs font-bold text-amber-800">Dokładnie {estimate?.candidateCount || 0} wybranych spotów · {Object.entries(estimate?.groups || {}).map(([group, count]) => `${group}: ${count}`).join(' · ') || 'brak pul'} · próbka: {estimate?.sampleSize || sampleSize} spotów.</p>
          <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={20}/><div><h4 className="font-black text-amber-950">Potwierdź potencjalnie płatną pracę AI</h4><p className="mt-1 text-sm text-amber-900">Skan znalazł {estimate?.candidateCount || 0} kandydatów. Zostaną wysłani w maksymalnie {estimate?.estimatedRequests || 0} żądaniach po {estimate?.batchSize || 20} spotów.</p><p className="mt-2 text-xs text-amber-800">Model: <strong>{selectedModel?.name || selectedModel?.id || 'brak'}</strong>. Poprawne partie są zapisywane od razu, a błędy nie są automatycznie ponawiane.</p></div></div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" data-testid="confirm-training-refresh" disabled={busy || refreshBlocked || !selectedModel?.configured || !estimate?.candidateCount} onClick={onConfirm} className="rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40">Potwierdzam do {estimate?.estimatedRequests || 0} żądań</button>
            <button type="button" disabled={busy} onClick={onCancelConfirmation} className="rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-xs font-black text-amber-900">Anuluj</button>
          </div>
          {!selectedModel?.configured && <p className="mt-3 text-xs font-bold text-rose-700">Wybrany model nie jest skonfigurowany na serwerze.</p>}
          {estimate?.candidateCount === 0 && <p className="mt-3 text-xs font-bold text-emerald-700">Brak kandydatów — kolekcja jest aktualna i żądanie AI nie jest potrzebne.</p>}
        </div>
      )}

      <div className="mt-5"><RefreshJobPanel job={job} busy={busy} onStop={onStop} onResume={onResume}/></div>
      {resumableJob && <p data-testid="training-refresh-resume-required" className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs font-bold text-indigo-800">Poprzednie zadanie ma jeszcze nieprzetworzone partie. Najpierw kliknij „Wznów” i dokończ je; nowe zadanie AI pozostaje zablokowane do tego czasu.</p>}

      <section data-testid="training-reset-settings" className="mt-6 rounded-2xl border border-rose-200 bg-rose-50/60 p-5">
        <div>
          <h4 className="text-base font-black text-rose-950">Czyszczenie pamięci ćwiczeń</h4>
          <p className="mt-1 text-xs text-rose-800">Operacja dotyczy wyłącznie kolekcji ćwiczeń. Historie rozdań i zwykłe analizy pokerowe pozostają nietknięte.</p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Spoty" value={asNumber(status?.counts?.spots ?? status?.spotCount)}/>
          <Metric label="Klucze AI" value={asNumber(status?.counts?.answerKeys ?? status?.answerKeyCount)}/>
          <Metric label="Zadania AI" value={asNumber(status?.counts?.refreshJobs ?? status?.refreshJobCount)}/>
          <Metric label="Sesje" value={asNumber(status?.counts?.sessions ?? status?.sessionCount)}/>
          <Metric label="Próby" value={asNumber(status?.counts?.attempts ?? status?.attemptCount)}/>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" data-testid="reset-training-answer-keys" disabled={busy || activeJob} onClick={() => onRequestReset?.('answer_keys')} className="rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-xs font-black text-rose-800 disabled:cursor-not-allowed disabled:opacity-40">Wyczyść analizy AI</button>
          <button type="button" data-testid="reset-training-all" disabled={busy || activeJob} onClick={() => onRequestReset?.('all')} className="rounded-xl bg-rose-700 px-4 py-2.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40">Pełny reset ćwiczeń</button>
        </div>
        {activeJob && <p className="mt-3 text-xs font-bold text-rose-800">Reset jest zablokowany, dopóki zadanie AI działa. Najpierw zatrzymaj je po bieżącej partii.</p>}
        {resetConfirmation && (
          <div data-testid="training-reset-confirmation" className="mt-4 rounded-xl border border-rose-300 bg-white p-4 text-sm text-rose-950">
            <strong>{resetConfirmation.scope === 'all' ? 'Pełny reset usunie całą kolekcję ćwiczeń.' : 'Wyczyszczenie analiz AI usunie klucze i zadania AI.'}</strong>
            <p className="mt-2 text-xs">Do usunięcia: {resetConfirmation.scope === 'all'
              ? `${asNumber(status?.counts?.spots)} spotów, ${asNumber(status?.counts?.answerKeys)} kluczy, ${asNumber(status?.counts?.refreshJobs)} zadań, ${asNumber(status?.counts?.sessions)} sesji i ${asNumber(status?.counts?.attempts)} prób.`
              : `${asNumber(status?.counts?.answerKeys)} kluczy i ${asNumber(status?.counts?.refreshJobs)} zadań; aktywne sesje zostaną przerwane, a próby pozostaną.`}</p>
            <div className="mt-3 flex gap-2"><button type="button" data-testid="confirm-training-reset" disabled={busy || activeJob} onClick={onConfirmReset} className="rounded-xl bg-rose-700 px-4 py-2 text-xs font-black text-white disabled:opacity-40">Potwierdź reset</button><button type="button" data-testid="cancel-training-reset" disabled={busy} onClick={onCancelReset} className="rounded-xl border border-rose-300 px-4 py-2 text-xs font-black text-rose-800">Anuluj</button></div>
          </div>
        )}
      </section>
    </section>
  );
};

export const SettingsView = ({ trainingApi = defaultTrainingApi }) => {
  const dispatch = useDispatch();
  const aiModels = useSelector((state) => state.poker.aiModels);
  const aiModelsError = useSelector((state) => state.poker.aiModelsError);
  const aiModelsStatus = useSelector((state) => state.poker.aiModelsStatus);
  const defaultAiModel = useSelector((state) => state.poker.defaultAiModel);
  const [trainingStatus, setTrainingStatus] = useState(null);
  const [trainingError, setTrainingError] = useState('');
  const [busy, setBusy] = useState('');
  const [sampleSize, setSampleSize] = useState(DEFAULT_TRAINING_REFRESH_SAMPLE_SIZE);
  const [confirmation, setConfirmation] = useState(null);
  const [rebuildWarning, setRebuildWarning] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState(null);
  const isLoading = aiModelsStatus === 'loading';
  const selectedModel = trainingStatus?.models?.find(({ id }) => id === defaultAiModel)
    || aiModels.find(({ id }) => id === defaultAiModel);
  const displayedRefreshJob = trainingStatus?.resumableRefreshJob || trainingStatus?.refreshJob;
  const refreshJobId = displayedRefreshJob?.id;
  const refreshJobStatus = displayedRefreshJob?.status;
  const staleRefreshJobId = useRef(null);

  const loadTrainingStatus = useCallback(async () => {
    try {
      const next = await trainingApi.getTrainingStatus({ sampleSize });
      setTrainingStatus(next);
      setTrainingError('');
      return next;
    } catch (error) {
      setTrainingError(error.message || 'Nie udało się pobrać stanu kolekcji ćwiczeń.');
      return null;
    }
  }, [sampleSize, trainingApi]);

  useEffect(() => {
    let cancelled = false;
    void trainingApi.getTrainingStatus({ sampleSize }).then(
      (next) => {
        if (cancelled) return;
        setTrainingStatus(next);
        setTrainingError('');
      },
      (error) => {
        if (!cancelled) setTrainingError(error.message || 'Nie udało się pobrać stanu kolekcji ćwiczeń.');
      },
    );
    return () => { cancelled = true; };
  }, [sampleSize, trainingApi]);

  useEffect(() => {
    if (!refreshJobId || !ACTIVE_JOB_STATUSES.has(refreshJobStatus)
      || staleRefreshJobId.current === refreshJobId) return undefined;
    let cancelled = false;
    let timer = null;
    let inFlight = false;
    let failureIndex = 0;
    const isVisible = () => globalThis.document?.visibilityState !== 'hidden';
    const schedule = (delay) => {
      if (cancelled || !isVisible()) return;
      if (timer !== null) globalThis.clearTimeout(timer);
      timer = globalThis.setTimeout(run, delay);
    };
    const run = async () => {
      if (cancelled || inFlight || !isVisible()) return;
      inFlight = true;
      try {
        const result = await trainingApi.getTrainingRefreshJob(refreshJobId);
        if (cancelled) return;
        failureIndex = 0;
        setTrainingStatus((current) => mergeRefreshJob(current, result.job));
        if (!ACTIVE_JOB_STATUSES.has(result.job?.status)) {
          await loadTrainingStatus();
          return;
        }
        schedule(2_000);
      } catch (error) {
        if (cancelled) return;
        if (error?.code === 'TRAINING_REFRESH_JOB_NOT_FOUND' || error?.status === 404) {
          staleRefreshJobId.current = refreshJobId;
          const authoritative = await loadTrainingStatus();
          const currentId = authoritative?.resumableRefreshJob?.id || authoritative?.refreshJob?.id;
          if (!currentId || currentId === refreshJobId) {
            setTrainingError('Zadanie AI nie istnieje już na serwerze. Pobraliśmy autorytatywny stan kolekcji; sprawdź dziennik diagnostyczny lub uruchom analizę ponownie.');
          }
          return;
        }
        const delay = POLL_BACKOFF_MS[Math.min(failureIndex, POLL_BACKOFF_MS.length - 1)];
        failureIndex += 1;
        setTrainingError(error.message || 'Nie udało się odświeżyć stanu zadania AI.');
        schedule(delay);
      } finally {
        inFlight = false;
      }
    };
    const wake = () => {
      if (!cancelled && isVisible()) {
        failureIndex = 0;
        schedule(0);
      }
    };
    globalThis.addEventListener?.('focus', wake);
    globalThis.addEventListener?.('online', wake);
    globalThis.document?.addEventListener?.('visibilitychange', wake);
    schedule(2_000);
    return () => {
      cancelled = true;
      if (timer !== null) globalThis.clearTimeout(timer);
      globalThis.removeEventListener?.('focus', wake);
      globalThis.removeEventListener?.('online', wake);
      globalThis.document?.removeEventListener?.('visibilitychange', wake);
    };
  }, [loadTrainingStatus, refreshJobId, refreshJobStatus, trainingApi]);

  const scanCollection = async (rebuildSelection = false) => {
    setBusy('scan');
    setTrainingError('');
    setConfirmation(null);
    try {
      const result = await trainingApi.scanTrainingCollection({ rebuildSelection, sampleSize });
      setTrainingStatus(result.status);
      setConfirmation({ estimate: result.status.refreshEstimate, scan: result.scan });
      setRebuildWarning(false);
    } catch (error) {
      setTrainingError(error.message || 'Nie udało się przeskanować kolekcji.');
    } finally {
      setBusy('');
    }
  };

  const confirmRefresh = async () => {
    if (!confirmation || !selectedModel?.configured) return;
    setBusy('start');
    setTrainingError('');
    try {
      const result = await trainingApi.startTrainingRefresh({
        modelId: defaultAiModel,
        sampleSize,
        confirmed: true,
      });
      staleRefreshJobId.current = null;
      setTrainingStatus((current) => mergeRefreshJob(current, result.job));
      setConfirmation(null);
    } catch (error) {
      if (error.resumableJob) {
        setTrainingStatus((current) => mergeRefreshJob(current, error.resumableJob));
        setConfirmation(null);
      }
      setTrainingError(error.message || 'Nie udało się rozpocząć odświeżania.');
    } finally {
      setBusy('');
    }
  };

  const stopRefresh = async () => {
    setBusy('stop');
    setTrainingError('');
    try {
      const result = await trainingApi.stopTrainingRefresh(displayedRefreshJob.id);
      setTrainingStatus((current) => mergeRefreshJob(current, result.job));
    } catch (error) {
      setTrainingError(error.message || 'Nie udało się zatrzymać odświeżania.');
    } finally {
      setBusy('');
    }
  };

  const resumeRefresh = async () => {
    setBusy('resume');
    setTrainingError('');
    try {
      const result = await trainingApi.resumeTrainingRefresh(displayedRefreshJob.id);
      staleRefreshJobId.current = null;
      setTrainingStatus((current) => mergeRefreshJob(current, result.job));
    } catch (error) {
      setTrainingError(error.message || 'Nie udało się wznowić odświeżania.');
    } finally {
      setBusy('');
    }
  };

  const confirmReset = async () => {
    if (!resetConfirmation) return;
    setBusy('reset');
    setTrainingError('');
    try {
      const result = await trainingApi.resetTrainingCollection({ scope: resetConfirmation.scope, confirmed: true });
      setTrainingStatus((current) => ({ ...current, ...result.status }));
      setResetConfirmation(null);
      setConfirmation(null);
      setRebuildWarning(false);
    } catch (error) {
      setTrainingError(error.message || 'Nie udało się wyczyścić kolekcji ćwiczeń.');
    } finally {
      setBusy('');
    }
  };

  const refreshAllStatuses = () => {
    dispatch(fetchAiModels());
    void loadTrainingStatus();
  };

  const changeSampleSize = (value) => {
    setSampleSize(value);
    setConfirmation(null);
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 animate-in fade-in duration-300">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
          <h3 className="flex items-center gap-2 text-xl font-bold"><Key className="text-indigo-600"/> Konfiguracja trenera AI</h3>
          <button type="button" onClick={refreshAllStatuses} disabled={isLoading} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50"><RefreshCw size={14} className={isLoading ? 'animate-spin' : ''}/> Odśwież status</button>
        </div>
        <div className="flex max-w-2xl flex-col gap-5">
          <p className="text-sm text-gray-600">Klucze dostawców są odczytywane wyłącznie przez lokalny serwer z pliku <code>.env.local</code>. Nie są zapisywane w przeglądarce ani wysyłane do interfejsu.</p>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-bold text-gray-800">Domyślny model analizy</legend>
            {isLoading && <div role="status" className="flex items-center gap-2 text-sm text-indigo-600"><RefreshCw size={16} className="animate-spin"/> Pobieranie konfiguracji modeli…</div>}
            {aiModels.map((model) => {
              const isSelected = defaultAiModel === model.id;
              return <label key={model.id} className={`flex items-center justify-between gap-4 rounded-xl border p-4 transition-colors ${model.configured ? 'cursor-pointer bg-white hover:border-indigo-300' : 'cursor-not-allowed bg-gray-50 text-gray-400'} ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-gray-200'}`}>
                <span className="flex items-center gap-3"><input type="radio" name="default-ai-model" value={model.id} checked={isSelected} disabled={!model.configured} onChange={() => dispatch(setDefaultAiModel(model.id))} className="h-4 w-4 accent-indigo-600"/><span><span className="block text-sm font-bold text-gray-800">{model.name}</span><span className="mt-1 block text-xs">{model.id}</span></span></span>
                <span className={`flex items-center gap-1.5 text-xs font-bold ${model.configured ? 'text-green-600' : 'text-gray-400'}`}>{model.configured ? <CheckCircle size={16}/> : <AlertTriangle size={16}/>} {model.configured ? 'Skonfigurowany' : 'Brak klucza'}</span>
              </label>;
            })}
          </fieldset>
          {aiModelsStatus === 'failed' && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle size={18} className="mt-0.5 shrink-0"/>{aiModelsError}</div>}
          <p className="text-xs text-gray-500">Zmiana modelu nie przelicza istniejących kluczy. Każdy klucz zachowuje model, wersję kontraktu i datę utworzenia; nowy wybór obowiązuje dopiero przy następnym odświeżeniu.</p>
        </div>
      </div>

      {trainingError && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><AlertTriangle size={18} className="mt-0.5 shrink-0"/>{trainingError}</div>}
      {!trainingStatus ? (
        <div role="status" className="rounded-2xl border border-indigo-100 bg-indigo-50 p-6 text-center text-sm font-bold text-indigo-700"><Clock3 className="mx-auto mb-2"/> Ładowanie stanu kolekcji ćwiczeń…</div>
      ) : (
        <TrainingCollectionSettings
          status={trainingStatus}
          selectedModel={selectedModel}
          sampleSize={sampleSize}
          confirmation={confirmation}
          busy={busy}
          onSampleSizeChange={changeSampleSize}
          onScan={scanCollection}
          onRequestRebuild={() => { setConfirmation(null); setRebuildWarning(true); }}
          rebuildWarning={rebuildWarning}
          onCancelRebuild={() => setRebuildWarning(false)}
          onRebuild={() => scanCollection(true)}
          onConfirm={confirmRefresh}
          onCancelConfirmation={() => setConfirmation(null)}
          onStop={stopRefresh}
          onResume={resumeRefresh}
          resetConfirmation={resetConfirmation}
          onRequestReset={(scope) => { setConfirmation(null); setRebuildWarning(false); setResetConfirmation({ scope }); }}
          onCancelReset={() => setResetConfirmation(null)}
          onConfirmReset={confirmReset}
        />
      )}
    </div>
  );
};
