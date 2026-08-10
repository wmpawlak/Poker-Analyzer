# Przywrócenie funkcji UI po migracji backendowej

## Podsumowanie

Naprawa obejmuje cztery potwierdzone regresje:

- filtrowanie układów działa tylko na pierwszej stronie 100 rozdań;
- z Cash/Turniejów zniknęły kolekcje analizowanych i zapisanych rąk oraz filtrowanie przeanalizowanych sesji;
- „Analiza wielu sesji” straciła ikonografię, metryki, sekcje raportu i odnośniki;
- „Karty startowe” dziedziczą niewidoczny zakres dat z profilu, przez co wyglądają na niekompletnie zindeksowane.

Dane źródłowe są kompletne: zaimportowano 18 033 rozdania bez błędów, 18 032 kwalifikują się do dwukartowej tabeli Hold’em i wszystkie 169 klas ma dane. Parsera, JSONL i formatu cache nie należy przebudowywać.

## Zadania implementacyjne

### 1. Poprawić filtrowanie układów po stronie backendu

- Rozszerzyć `GET /api/sessions` o `handRanking`.
- Backend ma zwracać:
  - `availableRanks: [{ id, count }]` dla całego wybranego Cash/Turniejowego datasetu;
  - tylko sesje zawierające wybrany układ;
  - `matchingHandCount` dla każdej sesji.
- Rozszerzyć `GET /api/sessions/:id/hands` o `handRanking`, `sortBy`, `sortOrder`, `cursor` i `limit`.
- Najpierw filtrować i sortować pełną sesję, dopiero potem stronicować.
- Cursor musi być powiązany z rewizją datasetu oraz aktualnym filtrem i sortowaniem.
- Usunąć frontendowe filtrowanie wyłącznie `loadedHands` i blokowanie kolejnych stron po wybraniu układu.

**Gotowe, gdy:** wybór karety pokazuje wszystkie 14 istniejących karet niezależnie od ich miejsca w paginacji, a lista dostępnych układów zawiera również rzadkie wyniki.

### 2. Przywrócić kolekcje rąk

- Dodać `POST /api/hand-collections/query`.
- Żądanie zawiera:
  - `datasetRevision`, `gameType`;
  - `mode: analyzed | saved`;
  - identyfikatory analizowanych i zapisanych rąk;
  - `handRanking`, sortowanie, cursor i limit.
- Backend wybiera wyłącznie ręce istniejące w indeksie, deduplikuje ID i ignoruje usunięte rekordy.
- Odpowiedź zwraca stronę skrótów rąk, `total`, `nextCursor` oraz liczniki kolekcji dla bieżącego typu gry.
- Cursor uwzględnia tryb, typ gry, filtr, sortowanie i hash przekazanych identyfikatorów.

**Gotowe, gdy:** zakładki „Z analizą” i „Zapisane ręce” znów działają w Cash i Turniejach bez ładowania pełnego datasetu do przeglądarki.

### 3. Przywrócić filtry analiz sesji w Cash i Turniejach

- Odtworzyć trzy widoki kolekcji: sesje, ręce z analizą, zapisane ręce.
- W widoku sesji dodać filtr:
  - wszystkie;
  - z aktualnym raportem;
  - bez aktualnego raportu — brak raportu lub raport nieaktualny.
- Raport jest aktualny, gdy jego fingerprint odpowiada sesji, a rewizja datasetu jest zgodna; raport legacy bez rewizji może być uznany za aktualny przy zgodnym fingerprint.
- Na wierszu sesji pokazać status ikoną:
  - `Brain` — aktualna analiza;
  - ostrzeżenie — analiza nieaktualna;
  - brak ikony — brak analizy.
- Ikony muszą mieć tooltip, `aria-label` i obsługę klawiatury.

**Gotowe, gdy:** można jednoznacznie znaleźć sesje już przeanalizowane oraz ręce z analizą lub zapisane.

### 4. Naprawić „Karty startowe”

- Oddzielić zakres dat kart od zakresu ustawianego w „Moim profilu”.
- Dodać do stanu `cardsDateFrom` i `cardsDateTo`; wartości domyślne są puste, czyli cała historia.
- W widoku kart dodać widoczny, własny zakres dat oraz przycisk czyszczenia.
- `GET /api/cards` ma jawnie agregować tylko dwukartowe warianty Hold’em: `NLH` i `NLH BombPot`; PLO nie trafia do tabeli 169.
- Odpowiedź rozszerzyć o:
  - `candidateHandCount`;
  - `indexedHandCount`;
  - `excludedHandCount`;
  - `excludedByReason.unsupportedVariant`;
  - `excludedByReason.invalidHeroCards`;
  - `populatedClassCount`.
- W UI pokazać aktywny zakres, liczbę zindeksowanych rozdań, liczbę wypełnionych klas z 169 oraz informację o pominiętych wariantach.
- Zachować filtr River/Showdown jako osobny filtr widoku.

**Gotowe, gdy:** wejście z profilu z ustawionymi datami nie ogranicza kart, domyślnie widoczne jest 18 032 poprawnie sklasyfikowanych rąk i 169/169 klas.

### 5. Przywrócić dane potrzebne analizie wielu sesji

- Dodać niegenerujący AI endpoint `POST /api/session-groups/preview`.
- Żądanie: `sessionIds`, `datasetRevision`.
- Odpowiedź: typ grupy, zakres dat, liczby sesji i rąk, podział Cash/Turniej, metryki wspólne i kategoriowe oraz kompaktowe źródła.
- Podgląd pobierać po zmianie zaznaczenia z debounce i anulowaniem nieaktualnych żądań.
- Rozszerzyć odpowiedź `POST /api/ai/analyze-session-group` o bezpieczne metadane rozwiązanej grupy: `activeCategory`, `dateRange`, `sources`, `sessionCount`, `handCount`, `categoryBreakdown`.
- Zapisywać te pola razem z raportem w Redux/cache.

**Gotowe, gdy:** metryki wybranych sesji są widoczne przed analizą, a nowy raport zawiera komplet danych potrzebnych do pełnego renderowania i linkowania.

### 6. Odtworzyć pełny UX „Analizy wielu sesji”

- Przywrócić ikonowy język interakcji:
  - `Square`/`CheckSquare` dla zaznaczenia;
  - `Brain` dla uruchomienia analizy;
  - `LoaderCircle` podczas generowania;
  - `Clock3` dla historii.
- Nie zastępować tych akcji linkami tekstowymi; każda ikona dostaje tooltip, `aria-label`, focus i stan disabled.
- Przywrócić:
  - lokalny podgląd metryk;
  - podsumowanie sesji;
  - mocne strony;
  - powtarzalne błędy i korekty;
  - trzy priorytety treningowe;
  - wnioski Cash/Turniej;
  - tendencje i rekomendacje;
  - źródła i historię raportów.
- Kliknięcie źródła sesji otwiera Cash lub Turnieje; kliknięcie rozdania pobiera je leniwie przez `GET /api/hands/:id`.
- Brakujący rekord lub stary uproszczony raport nie może wywracać widoku: dostępna treść pozostaje widoczna, a niemożliwy link jest wyłączony z komunikatem.
- Nie oznaczać raportu jako przestarzałego wyłącznie przez dowolną zmianę datasetu; porównywać fingerprinty jego rzeczywistych źródeł.

**Gotowe, gdy:** nowy i historyczny pełny raport odtwarza wszystkie wcześniejsze sekcje, a uproszczony raport nadal daje się bezpiecznie odczytać.

## Zmiany interfejsów publicznych

- `GET /api/sessions?gameType&handRanking`
- `GET /api/sessions/:id/hands?handRanking&sortBy&sortOrder&cursor&limit`
- `POST /api/hand-collections/query`
- `GET /api/cards?gameType&dateFrom&dateTo&riverOrShowdownOnly` — dodatkowe metadane kompletności i jawna semantyka Hold’em.
- `POST /api/session-groups/preview`
- `POST /api/ai/analyze-session-group` — rozszerzona odpowiedź o metadane grupy i źródła.

Wszystkie nowe odpowiedzi muszą nadal zwracać `datasetRevision`. Listy rozdań zawierają wyłącznie skróty bez `rawText`.

## Plan testów

### Jeden checkpoint backendowy po zadaniach 1, 2, 4 i 5

Uruchomić:

```text
node --test test/data-api.test.js test/ai-data-resolution.test.js test/poker-regressions.test.js
```

Pokryć:

- rzadki układ znajdujący się poza pierwszą stroną;
- filtrowanie przed paginacją i unieważnianie cursora po zmianie filtra;
- kompletne `availableRanks`;
- deduplikację kolekcji oraz brakujące ID;
- podgląd grupy bez wywołania modelu AI;
- metadane i źródła nowego raportu grupowego;
- 169 klas rąk startowych;
- niezależny zakres dat kart;
- uwzględnianie NLH/NLH BombPot i jawne pomijanie PLO;
- zgodność liczników `candidate/indexed/excluded`.

### Jedna końcowa weryfikacja po całym frontendzie

Rozszerzyć istniejące testy UI o:

- widoczność karety i filtrowanie całego wyniku;
- zakładki analizowanych i zapisanych rąk;
- filtry aktualnej, nieaktualnej i brakującej analizy sesji;
- dostępność ikon;
- niezależność dat kart od profilu i widoczny licznik kompletności;
- pełne sekcje raportu grupowego i klikalne źródła;
- bezpieczne renderowanie uproszczonego raportu historycznego.

Następnie uruchomić tylko raz:

```text
npm test
npm run lint
npm run build
```

Nie uruchamiać `perf:data`, ponieważ format indeksu i kanoniczne dane nie są zmieniane. Nie wykonywać prawdziwych wywołań modeli AI.

## Założenia

- Klasyczne statystyki 169 obejmują NLH oraz dwukartowy NLH Bomb Pot, ale nie PLO.
- „Karty startowe” domyślnie pokazują całą historię i mają własny filtr dat.
- Globalny przełącznik Wszystko/Cash/Turnieje pozostaje wspólny dla profilu, przeciwników i kart.
- Zachowujemy backendową, stronicowaną architekturę; pełny dataset i surowe teksty rozdań nie wracają do pamięci przeglądarki.
- Nie zmieniamy parsera, JSONL, wersji cache ani procesu migracji danych.
