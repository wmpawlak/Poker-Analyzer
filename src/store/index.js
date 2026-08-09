import { configureStore, createListenerMiddleware } from '@reduxjs/toolkit';
import pokerReducer, {
  analyzeHandWithAI,
  analyzeSessionGroupWithAI,
  analyzeSessionWithAI,
  getMergedSessionIds,
  removeSource,
  syncAiAnalyses,
  syncLocalSources,
  toggleSource,
  uploadHandHistory,
} from './pokerSlice.js';

const aiCacheListener = createListenerMiddleware();
const syncSharedAiCache = async (_action, listenerApi, sessionIds = []) => {
  await listenerApi.dispatch(syncAiAnalyses({ sessionIds }));
};

[
  analyzeHandWithAI.fulfilled,
  analyzeSessionWithAI.fulfilled,
  analyzeSessionGroupWithAI.fulfilled,
].forEach((actionCreator) => {
  aiCacheListener.startListening({
    actionCreator,
    effect: syncSharedAiCache,
  });
});

[
  uploadHandHistory,
  toggleSource,
  removeSource,
  syncLocalSources.fulfilled,
].forEach((actionCreator) => {
  aiCacheListener.startListening({
    actionCreator,
    effect: async (_action, listenerApi) => {
      const sessionIds = getMergedSessionIds(listenerApi.getState().poker.tournaments);
      if (sessionIds.length > 0) await syncSharedAiCache(_action, listenerApi, sessionIds);
    },
  });
});

export const store = configureStore({
  reducer: {
    poker: pokerReducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware({
    serializableCheck: {
      // Te gałęzie zawierają bardzo duże, ale nadal serializowalne logi tekstowe.
      // Pomijamy ich ponowne skanowanie po każdej drobnej akcji interfejsu.
      ignoredPaths: ['poker.sources', 'poker.rawHands', 'poker.sessions', 'poker.tournaments'],
      // Payload zawiera cały wgrywany plik tekstowy, więc jego jednorazowe
      // przechodzenie przez kontrolę serializowalności nie daje nam żadnej wartości.
      ignoredActions: [uploadHandHistory.type, syncLocalSources.fulfilled.type],
    },
  }).prepend(aiCacheListener.middleware),
});
