# Plan realizacji dla modelu Luna

## Zasady wykonania

- Pracuj w istniejącym repozytorium i zachowaj wszystkie niezacommitowane zmiany.
- Realizuj zadania kolejno.
- Nie uruchamiaj testów, lintowania ani buildu przed ostatnim zadaniem.
- Nie wykonuj prawdziwych ani płatnych żądań do OpenAI/Gemini.
- Każde zadanie powinno zakończyć się działającym kodem, ale weryfikacja automatyczna następuje dopiero na końcu.

## Zadanie 1 — Audyt obecnego stanu

- Przeczytaj `plans/statystyki-wielu-sesji.md`.
- Sprawdź istniejące zmiany w kontrakcie, API, Reduxie i UI.
- Nie implementuj ponownie już gotowych elementów.
- Zidentyfikuj brakujące fragmenty względem planu.
- Potwierdź, że pełne rozdania są używane tylko lokalnie, a nie wysyłane do modelu.

Kryterium ukończenia: lista braków i miejsc do poprawy jest jasna, bez modyfikowania istniejącej funkcjonalności.

## Zadanie 2 — Kompaktowy kontrakt danych grupy

Zakres: `src/ai/sessionGroupAnalysisContract.js`, `src/utils/sessionGroupCandidates.js`.

- Zachowaj lokalne obliczanie metryk z pełnych rozdań.
- Do grupy wysyłanej do API przekazuj wyłącznie:
  - agregaty wspólne,
  - osobne metryki Cash i Turniejów,
  - metadane sesji,
  - skrócone raporty źródłowe,
  - `sourceId`, `reportId` i wskazane `handIds`.
- Nie przekazuj kart, akcji, `rawText`, `hands` ani historii rozdań.
- Dodaj osobny kontekst modelu, który usuwa techniczne dane niepotrzebne modelowi: fingerprinty, rozmiary, model raportu i datę utworzenia.
- Zachowaj walidację fingerprintów i aktualności raportów po stronie serwera.
- Zachowaj deterministyczne sortowanie źródeł i ochronę przed duplikatami.

Kryterium ukończenia: model otrzymuje tylko zagregowane wnioski i referencje do istniejących rozdań.

## Zadanie 3 — Uproszczenie schematu Gemini

Zakres: kontrakt odpowiedzi i adapter Gemini.

- Gemini używa uproszczonego schematu bez zagnieżdżonych `minItems` i `maxItems`.
- OpenAI nadal używa pełnego ścisłego schematu.
- Limity odpowiedzi egzekwuje walidator serwera po odpowiedzi modelu:
  - dokładnie trzy priorytety,
  - maksymalnie pięć mocnych stron,
  - maksymalnie pięć powtarzalnych błędów,
  - poprawne źródła i `handIds`.
- Zachowaj propagowanie dokładnego komunikatu błędu Gemini do UI.

Kryterium ukończenia: Gemini nie dostaje schematu powodującego błąd „too many states”.

## Zadanie 4 — Prompt i endpoint backendowy

Zakres: `server/ai/analysisService.js`, `server/app.js`.

- Prompt ma jasno nakazywać analizę po polsku na podstawie istniejących raportów.
- Model ma łączyć wspólne wzorce z raportów sesji, bez ponownego analizowania pełnych rozdań.
- Zachowaj osobne jednostki wyników Cash i Turniejów.
- Endpoint `POST /api/ai/analyze-session-group` wykonuje jedno żądanie na jedno ręczne uruchomienie.
- Nie dodawaj automatycznych retry, zmiany modelu, dzielenia próbki ani cichego obcinania danych.
- OpenAI zachowuje `32000` tokenów wyjściowych i `high`; konfiguracja Gemini pozostaje bez zmian.

Kryterium ukończenia: backend przyjmuje zwalidowaną grupę, wysyła kompaktowy prompt i zwraca `{ model, fingerprint, analysis }`.

## Zadanie 5 — Redux i historia raportów

Zakres: `src/store/pokerSlice.js`.

- Dodaj lub zachowaj osobny thunk i stan dla analizy wielu sesji.
- Zapisuj pełną historię raportów grupowych.
- Nie zapisuj błędnych ani niepełnych odpowiedzi.
- Oznaczaj raport jako nieaktualny po zmianie sesji, fingerprintu lub raportu źródłowego.
- Sprawdzaj, czy fingerprint odpowiedzi odpowiada fingerprintowi wysłanej grupy.
- Zachowaj czyszczenie danych przez `clearData`.

Kryterium ukończenia: historia jest odporna na błędy i nie miesza się z historią pojedynczych sesji.

## Zadanie 6 — Widok wyboru sesji i layout

Zakres: `SessionGroupAnalysisView.jsx`, `ProfileViews.jsx`, `App.jsx`.

- Zachowaj filtry Wszystko/Cash/Turnieje oraz zakres dat.
- Zmiana filtra lub dat usuwa wyłącznie niewidoczne zaznaczenia.
- Lista sesji ma własny przewijany obszar.
- Podgląd metryk lokalnych nie może zajmować połowy strony; powinien być zwijany i mieć ograniczoną wysokość.
- Panel główny ma wykorzystywać całą dostępną wysokość aplikacji.
- Przycisk analizy jest aktywny dopiero przy minimum dwóch poprawnych sesjach.
- Dostępność historycznych sesji i rozdań ustalaj na podstawie aktualnych danych, niezależnie od aktualności raportu AI.

Kryterium ukończenia: zaznaczenie pięciu sesji nie powoduje pustego ani zasłoniętego widoku.

## Zadanie 7 — Raport, źródła i dokumentacja

- Wyświetlaj styl, wiarygodność, podsumowanie, mocne strony, błędy, trzy priorytety i sekcje kategorii.
- Każdy wniosek, także podsumowanie główne, musi mieć widoczne źródła.
- Linki do istniejących sesji i rozdań powinny otwierać odpowiedni widok/Replayer.
- Niedostępne historyczne rozdania mają być nieaktywne, ale nie mogą powodować awarii.
- Uzupełnij README o sposób działania, rozdzielenie wyników Cash/Turniejów, historię i koszt ręcznego uruchomienia.

Kryterium ukończenia: użytkownik może przejść od każdego wniosku do dostępnego źródła.

## Zadanie 8 — Przygotowanie końcowej weryfikacji

- Sprawdź, czy backend został uruchomiony ponownie po zmianach serwera.
- Sprawdź, czy nie ma zmian wykraczających poza plan.
- Nie uruchamiaj jeszcze testów ani buildu.
- Przygotuj listę zmienionych plików i scenariuszy do sprawdzenia w zadaniu końcowym.

## Zadanie 9 — Testy i końcowa weryfikacja

Dopiero teraz uruchom:

- testy kontraktu grupowego,
- testy API Gemini/OpenAI,
- testy Redux/cache,
- testy kandydatów sesji,
- testy UI,
- pełne `npm test`,
- lint zmienionych plików,
- `npm run build`,
- `git diff --check`.

Szczególnie potwierdź:

- brak surowych historii w promptcie,
- poprawną obsługę pięciu sesji,
- brak błędu Gemini „too many states”,
- dokładnie trzy priorytety,
- poprawne źródła i `handIds`,
- brak zapisu historii po błędzie,
- prawidłowe przewijanie i pełną wysokość widoku.

Raport końcowy ma zawierać wynik każdego polecenia oraz ewentualne pozostałe problemy.
