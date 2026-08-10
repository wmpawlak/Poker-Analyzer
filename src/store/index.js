import { configureStore, createListenerMiddleware } from '@reduxjs/toolkit';
import pokerReducer, {
  analyzeHandWithAI,
  analyzeSessionGroupWithAI,
  analyzeSessionWithAI,
  syncAiAnalyses,
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

export const store = configureStore({
  reducer: {
    poker: pokerReducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware()
    .prepend(aiCacheListener.middleware),
});
