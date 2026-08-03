import { configureStore } from '@reduxjs/toolkit';
import pokerReducer, { syncLocalSources, uploadHandHistory } from './pokerSlice.js';

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
  }),
});
