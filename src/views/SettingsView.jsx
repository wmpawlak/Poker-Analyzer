import { useDispatch, useSelector } from 'react-redux';
import { AlertTriangle, CheckCircle, Key, RefreshCw } from 'lucide-react';
import { fetchAiModels, setDefaultAiModel } from '../store/pokerSlice.js';

export const SettingsView = () => {
  const dispatch = useDispatch();
  const aiModels = useSelector((state) => state.poker.aiModels);
  const aiModelsError = useSelector((state) => state.poker.aiModelsError);
  const aiModelsStatus = useSelector((state) => state.poker.aiModelsStatus);
  const defaultAiModel = useSelector((state) => state.poker.defaultAiModel);
  const isLoading = aiModelsStatus === 'loading';

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6 animate-in fade-in duration-300">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
          <h3 className="text-xl font-bold flex items-center gap-2"><Key className="text-indigo-600"/> Konfiguracja trenera AI</h3>
          <button type="button" onClick={() => dispatch(fetchAiModels())} disabled={isLoading} className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"><RefreshCw size={14} className={isLoading ? 'animate-spin' : ''}/> Odśwież status</button>
        </div>
        <div className="flex flex-col gap-5 max-w-2xl">
          <p className="text-sm text-gray-600">Klucze dostawców są odczytywane wyłącznie przez lokalny serwer z pliku <code>.env.local</code>. Nie są zapisywane w przeglądarce ani wysyłane do interfejsu.</p>
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-bold text-gray-800 mb-2">Domyślny model analizy</legend>
            {isLoading && <div role="status" className="text-sm text-indigo-600 flex items-center gap-2"><RefreshCw size={16} className="animate-spin"/> Pobieranie konfiguracji modeli…</div>}
            {aiModels.map((model) => {
              const isSelected = defaultAiModel === model.id;
              return <label key={model.id} className={`flex items-center justify-between gap-4 rounded-xl border p-4 transition-colors ${model.configured ? 'cursor-pointer hover:border-indigo-300 bg-white' : 'cursor-not-allowed bg-gray-50 text-gray-400'} ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-gray-200'}`}>
                <span className="flex items-center gap-3"><input type="radio" name="default-ai-model" value={model.id} checked={isSelected} disabled={!model.configured} onChange={() => dispatch(setDefaultAiModel(model.id))} className="w-4 h-4 accent-indigo-600"/><span><span className="block text-sm font-bold text-gray-800">{model.name}</span><span className="block text-xs mt-1">{model.id}</span></span></span>
                <span className={`text-xs font-bold flex items-center gap-1.5 ${model.configured ? 'text-green-600' : 'text-gray-400'}`}>{model.configured ? <CheckCircle size={16}/> : <AlertTriangle size={16}/>} {model.configured ? 'Skonfigurowany' : 'Brak klucza'}</span>
              </label>;
            })}
          </fieldset>
          {aiModelsStatus === 'failed' && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2"><AlertTriangle size={18} className="shrink-0 mt-0.5"/>{aiModelsError}</div>}
          <p className="text-xs text-gray-500">Aplikacja zapamiętuje w przeglądarce wyłącznie identyfikator wybranego modelu. Model bez odpowiedniego klucza pozostaje widoczny, ale nie można go użyć.</p>
        </div>
      </div>
    </div>
  );
};
