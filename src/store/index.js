import { configureStore } from '@reduxjs/toolkit';
import pokerReducer from './pokerSlice.js';

export const store = configureStore({
  reducer: {
    poker: pokerReducer,
  },
});