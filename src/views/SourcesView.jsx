import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Database, FileCode2, GitBranch, RefreshCw, Upload } from 'lucide-react';
import {
  refreshDataset,
  refreshImportCenter,
  scanInbox,
  uploadImport,
} from '../store/pokerSlice.js';

const IMPORT_PHASE_LABELS = {
  scanning: 'sprawdzanie pliku',
  parsing: 'parsowanie rozdań',
  committing: 'zapis kanonicznych danych',
  reindexing: 'odbudowa indeksu',
  ready: 'zakończono',
  failed: 'błąd importu',
};

const formatImportedAt = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'data oczekuje na zapis' : date.toLocaleString('pl-PL');
};

const ImportCounters = ({ report }) => (
  <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
    {[
      ['Nowe', report?.added || 0, 'text-emerald-700'],
      ['Duplikaty', report?.duplicates || 0, 'text-slate-700'],
      ['Konflikty', report?.conflicts || 0, 'text-amber-700'],
      ['Błędy', report?.invalid || 0, 'text-red-700'],
    ].map(([label, value, color]) => (
      <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
        <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</p>
        <p className={`mt-0.5 font-mono text-lg font-black ${color}`}>{value}</p>
      </div>
    ))}
  </div>
);

const ImportRow = ({ imported }) => {
  const warning = imported.outcome === 'completed_with_warnings';
  const failed = imported.phase === 'failed' || imported.outcome === 'failed';
  const finished = imported.phase === 'ready' || failed;
  const phaseLabel = IMPORT_PHASE_LABELS[imported.phase] || imported.phase || 'oczekuje';
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <FileCode2 className={failed ? 'mt-0.5 shrink-0 text-red-500' : warning ? 'mt-0.5 shrink-0 text-amber-500' : 'mt-0.5 shrink-0 text-indigo-500'} size={21}/>
          <div className="min-w-0">
            <h4 className="truncate text-sm font-black text-slate-800" title={imported.filename}>{imported.filename || `Import ${imported.importId}`}</h4>
            <p className="mt-1 text-xs text-slate-500">{formatImportedAt(imported.importedAt || imported.queuedAt)}</p>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${failed ? 'bg-red-100 text-red-700' : warning ? 'bg-amber-100 text-amber-800' : finished ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
          {warning ? 'zakończono z ostrzeżeniami' : phaseLabel}
        </span>
      </div>
      <ImportCounters report={imported.report || imported}/>
      {imported.error?.message && <p role="alert" className="mt-3 text-xs font-semibold text-red-700">{imported.error.message}</p>}
    </article>
  );
};

export const SourcesView = () => {
  const dispatch = useDispatch();
  const dataset = useSelector((state) => state.poker.dataset);
  const importCenter = useSelector((state) => state.poker.importCenter);
  const isWorking = importCenter.actionStatus === 'loading'
    || importCenter.activeImportIds.length > 0
    || ['scanning', 'parsing', 'committing', 'reindexing'].includes(importCenter.phase);

  useEffect(() => {
    dispatch(refreshImportCenter());
    dispatch(refreshDataset());
  }, [dispatch]);

  useEffect(() => {
    if (!isWorking) return undefined;
    const timer = window.setInterval(() => {
      dispatch(refreshImportCenter());
      dispatch(refreshDataset());
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [dispatch, isWorking]);

  const upload = (file) => {
    if (file && /\.txt$/i.test(file.name)) dispatch(uploadImport({ file }));
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 animate-in fade-in duration-300">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><Database className="text-indigo-600" size={22}/><h3 className="text-xl font-black text-slate-800">Centrum importu</h3></div>
            <p className="mt-1 text-sm text-slate-500">Kanoniczny magazyn zawiera <strong className="text-slate-700">{dataset.handCount.toLocaleString('pl-PL')}</strong> unikalnych rozdań.</p>
          </div>
          <button type="button" onClick={() => { dispatch(refreshImportCenter()); dispatch(refreshDataset()); }} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"><RefreshCw size={14}/> Odśwież status</button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-sm font-black text-white shadow-sm transition-colors hover:bg-slate-700">
            <Upload size={17}/> Wgraj jeden plik TXT
            <input type="file" accept=".txt,text/plain" className="hidden" onChange={(event) => { upload(event.target.files[0]); event.target.value = ''; }}/>
          </label>
          <button type="button" disabled={importCenter.actionStatus === 'loading'} onClick={() => dispatch(scanInbox())} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"><RefreshCw size={17} className={importCenter.actionStatus === 'loading' ? 'animate-spin' : ''}/> Sprawdź katalog inbox</button>
        </div>
      </section>

      {(isWorking || importCenter.error) && <section className={`rounded-xl border p-4 ${importCenter.error ? 'border-red-200 bg-red-50 text-red-800' : 'border-indigo-200 bg-indigo-50 text-indigo-900'}`}>
        <div className="flex items-center gap-2 text-sm font-black">{isWorking && <RefreshCw size={16} className="animate-spin"/>}{importCenter.error ? 'Import wymaga uwagi' : `Postęp: ${IMPORT_PHASE_LABELS[importCenter.phase] || importCenter.phase}`}</div>
        {importCenter.error && <p role="alert" className="mt-1 text-sm">{importCenter.error}</p>}
      </section>}

      <section className="rounded-2xl border border-gray-200 bg-slate-50 p-5 shadow-sm">
        <h3 className="text-base font-black text-slate-800">Historia importów</h3>
        <p className="mt-1 text-xs text-slate-500">Import częściowo poprawny zachowuje prawidłowe ręce i otrzymuje jawne ostrzeżenie.</p>
        <div className="mt-4 space-y-3">{importCenter.imports.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">Nie ma jeszcze raportów importu.</p> : importCenter.imports.map((imported) => <ImportRow key={imported.importId} imported={imported}/>)}</div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600"><div className="flex items-center gap-2 font-black text-slate-800"><GitBranch size={17} className="text-slate-500"/> Dane wymagają ręcznego workflow Git</div><p className="mt-1">Po sprawdzeniu importu uruchom ręcznie <code>git status</code>, następnie wykonaj commit i push wyłącznie, gdy raport oraz zmiany danych są poprawne.</p></section>
    </div>
  );
};
