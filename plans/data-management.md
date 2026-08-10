# Plan wdrożenia dla Terra Mid: backendowa baza rozdań

## Zasady realizacji

- Każde zadanie jest osobnym, zamkniętym pakietem. Nie wykonywać elementów z kolejnych zadań „przy okazji”.
- Testy uruchamiać tylko w trzech punktach kontrolnych: po warstwie danych, po API oraz na końcu.
- Testy migracji zawsze pracują na katalogu tymczasowym, nigdy bezpośrednio na prawdziwym `data/`.
- Nie wykonywać automatycznie `git commit`, `pull` ani `push`.
- Nie uruchamiać prawdziwych wywołań AI podczas testów.
- Po każdym zadaniu zostawić krótki handoff: zmienione kontrakty, nowe moduły i znane ograniczenia.

## Ustalona architektura

Kanoniczne dane:

```text
data/
  inbox/                                # ręcznie skopiowane pliki do importu
  poker/
    hands/cash-YYYY.jsonl
    hands/tournament-YYYY.jsonl
    sources/<fileHash>.txt              # archiwum oryginalnych TXT
    imports/<fileHash>.json             # raport importu
    issues/<fileHash>.json              # konflikty i błędne ręce
  .cache/poker-index-vN.json.gz         # ignorowany cache
```

- JSONL i archiwum TXT są śledzone przez Git.
- Cache i pliki w trakcie zapisu są ignorowane.
- Jedna ręka występuje w JSONL tylko raz.
- Sesje, metryki i wykresy są danymi pochodnymi i nie trafiają do kanonicznego magazynu.
- Cash dzieli się na sesje per stół przy przerwie większej niż 30 minut.
- Zakładka źródeł staje się centrum importu; nie ma włączania ani wyłączania plików.

## Zadanie 1 — Ścisły kontrakt parsera

Cel: importer musi wyjaśniać, co zrobił z każdą sekcją TXT.

Implementacja:

- Wydzielić czystą funkcję parsowania pojedynczej ręki.
- Parser dokumentu ma zwracać:

```js
{
  validHands: [{ hand, rawText, ordinal }],
  issues: [{ ordinal, handId, reason }]
}
```

- W trybie ścisłym brak ID lub poprawnej daty oznacza odrzucenie ręki.
- Nie podstawiać bieżącej daty przy błędzie.
- Normalizować BOM, CRLF i zewnętrzne białe znaki przed hashowaniem.
- Typ Cash/Turniej ustalać dla każdej ręki osobno.
- Zachować dotychczasowe `parseRawHandHistory` jako kompatybilny wrapper.

Poza zakresem: zapis plików, migracja i API.

Gotowe, gdy każda sekcja dokumentu trafia do `validHands` albo `issues` i parser nie loguje cicho błędów.

## Zadanie 2 — Kanoniczne repozytorium JSONL

Cel: bezpiecznie dopisywać unikalne rozdania.

Implementacja:

- Dodać backendowy moduł repozytorium danych.
- Rekord JSONL:

```js
{
  version: 1,
  handId,
  gameType,
  playedAt,
  contentHash,
  firstImportId,
  rawText
}
```

- Zbudować indeks `handId → contentHash`.
- Reguły:

  - nowe ID: dopisz;
  - istniejące ID i ten sam hash: duplikat;
  - istniejące ID i inny hash: konflikt, bez nadpisania.

- Zapisywać do pliku odpowiadającego typowi i rokowi ręki.
- Aktualizację rocznego JSONL wykonywać przez plik tymczasowy i atomowy rename.
- Import musi być idempotentny po przerwaniu procesu.
- Nie przechowywać kopii sesji ani metryk.

Poza zakresem: skan katalogu, UI i worker indeksujący.

Gotowe, gdy dwukrotny import tych samych kandydatów nie zmienia magazynu.

## Zadanie 3 — Archiwum źródeł i raport importu

Cel: zachować oryginalny TXT i pełny audyt bez mnożenia identycznych plików.

Implementacja:

- Hash całego pliku jest `importId`.
- Oryginał zapisywać jako `sources/<importId>.txt`.
- Identycznego pliku nie archiwizować drugi raz.
- Zapisywać `imports/<importId>.json` z nazwą wejściową, datą, rozmiarem i licznikami:

```js
{
  total,
  added,
  duplicates,
  conflicts,
  invalid
}
```

- Konflikty i błędne rekordy zapisywać w `issues/<importId>.json` z numerem sekcji i przyczyną.
- Nie kopiować ponownie pełnego tekstu problematycznej ręki — znajduje się w archiwalnym TXT.
- Importować poprawne ręce mimo problemów w innych sekcjach.
- Operacje importu szeregować backendowym mutexem.

Gotowe, gdy częściowo uszkodzony plik zachowuje wszystkie poprawne unikalne ręce i jawny raport problemów.

## Zadanie 4 — Jawna migracja istniejących danych

Cel: przenieść obecne `data/*.txt` bez ponownego wgrywania.

Dodać komendy:

```powershell
npm run data:migrate -- --dry-run
npm run data:migrate -- --apply
```

`dry-run`:

- czyta obecne TXT;
- nie zapisuje ani nie przenosi plików;
- pokazuje liczbę poprawnych, nowych, zduplikowanych, konfliktowych i błędnych rąk;
- pokazuje przewidywaną liczbę sesji Cash/Turniej.

`apply`:

- zapisuje JSONL, archiwum źródeł i raporty;
- dopiero po zweryfikowaniu magazynu przenosi źródłowe TXT do archiwum;
- jest bezpieczne do ponownego uruchomienia.

Migracja analiz:

- zachować analizy pojedynczych rąk;
- usunąć wszystkie stare analizy sesji Cash;
- usunąć raporty grupowe zawierające Cash;
- analizy turniejowe zachować tylko przy zgodnym fingerprintcie;
- zaktualizować cache analiz atomowo;
- wypisać liczbę zachowanych i usuniętych raportów.

Nie uruchamiać `--apply` na prawdziwych danych w ramach automatycznych testów.

## Punkt kontrolny A — Testy integralności danych

Dopiero po zadaniach 1–4 dodać i uruchomić celowane testy:

```powershell
node --test test/data-import-parser.test.js test/data-repository.test.js test/data-migration.test.js
```

Minimalne scenariusze:

- identyczny duplikat;
- różniący się konflikt tego samego `handId`;
- jeden błędny rekord pośród poprawnych;
- ponowienie przerwanego importu;
- podział na lata i typ gry;
- migracja dry-run bez zapisów;
- Cash: przerwa równa 30 minut, większa niż 30 minut i przejście przez północ;
- zachowanie analiz rąk/turniejów i usunięcie analiz Cash.

Nie uruchamiać jeszcze całego `npm test`, lint ani build. Nie przechodzić dalej, jeśli ten punkt nie jest zielony.

## Zadanie 5 — Backendowy indeks i cache

Cel: przeglądarka nie parsuje ani nie przechowuje całej historii.

Implementacja:

- Uruchamiać parsowanie i agregację w workerze Node.
- Zbudować w pamięci:

  - indeks rąk;
  - sesje Cash i turniejowe;
  - metryki profilu;
  - przeciwników;
  - statystyki kart;
  - dane wykresów.

- Cache zawiera dane parsowane bez `rawText` oraz lokalizację rekordu JSONL.
- Rewizja datasetu zależy od wersji parsera i hashy kanonicznych plików.
- Zgodny cache ładować bez ponownego parsowania.
- Podczas przebudowy utrzymywać ostatnią poprawną rewizję.
- Przy pierwszym uruchomieniu bez cache udostępniać status postępu.
- Zmiana zestawu rąk unieważnia odpowiednie agregaty i fingerprinty sesji.

Gotowe, gdy backend może odtworzyć wszystkie obecne widoki bez wysyłania pełnej bazy do klienta.

## Zadanie 6 — API odczytu danych

Cel: dostarczać klientowi wyłącznie dane bieżącego widoku.

Dodać:

- `GET /api/data/status`
- `GET /api/dataset`
- `GET /api/sessions`
- `GET /api/sessions/:id/hands?cursor=&limit=100`
- `GET /api/hands/:id`
- `GET /api/profile`
- `GET /api/opponents`
- `GET /api/cards`
- `GET /api/wallet`

Reguły:

- każda odpowiedź zależna od danych zawiera `datasetRevision`;
- lista rąk jest stronicowana, domyślnie po 100;
- szczegóły i `rawText` jednej ręki są pobierane dopiero po kliknięciu;
- wallet zwraca maksymalnie 1200 punktów;
- downsampling zachowuje pierwszy, ostatni oraz lokalne minima i maksima;
- parametry filtrów są walidowane i mają te same znaczenia co obecny UI.

Poza zakresem: upload i AI.

## Zadanie 7 — API importu i postępu

Cel: obsłużyć UI oraz `data/inbox` jednym importerem.

Dodać:

- `POST /api/data/refresh`
- `POST /api/imports` jako `multipart/form-data`
- `GET /api/imports`
- `GET /api/imports/:id`

Zachowanie:

- skan `inbox` przy starcie backendu i po ręcznym odświeżeniu;
- brak watchera;
- upload oraz inbox korzystają dokładnie z tej samej usługi;
- czytelne fazy: `scanning`, `parsing`, `committing`, `reindexing`, `ready`, `failed`;
- podczas pracy API nadal serwuje poprzednią rewizję;
- po poprawnym lub częściowo poprawnym imporcie źródło trafia do archiwum;
- całkowicie nieczytelny plik pozostaje w inbox i otrzymuje status błędu.

## Zadanie 8 — Rozwiązywanie danych dla analiz AI

Cel: przestać przesyłać pełne ręce i sesje z przeglądarki.

Zmienić kontrakty:

```js
POST /api/ai/analyze
{ modelId, handId, datasetRevision }

POST /api/ai/analyze-session
{ modelId, sessionId, datasetRevision }

POST /api/ai/analyze-session-group
{ modelId, sessionIds, datasetRevision }
```

- Backend rozwiązuje ID do kanonicznych danych.
- Przy niezgodnej rewizji zwraca `409 DATASET_REVISION_MISMATCH`.
- Nie ponawia automatycznie potencjalnie płatnego żądania.
- Zachować dotychczasową walidację odpowiedzi i zasady cache analiz.
- Dodać konserwacyjne CLI do świadomego zastąpienia konfliktowej ręki; wymagane `--dry-run` i `--apply`.
- Zastąpienie ręki usuwa jej analizę i raporty zależne od zmienionego fingerprintu.

## Punkt kontrolny B — Testy API i AI

Po zadaniach 5–8 uruchomić wyłącznie testy backendowych kontraktów:

```powershell
node --test test/data-index.test.js test/data-api.test.js test/ai-data-resolution.test.js
```

Sprawdzić:

- cache zgodny i niezgodny z rewizją;
- stara rewizja dostępna podczas importu;
- stronicowanie bez powtórzeń;
- maksymalnie 1200 punktów wykresu;
- lazy loading `rawText`;
- `409` dla nieaktualnej rewizji;
- AI rozwiązuje te same dane co wcześniejszy frontend;
- brak prawdziwych wywołań dostawców.

Nie uruchamiać pełnego zestawu testów.

## Zadanie 9 — Lekki klient danych i Redux

Cel: usunąć ciężkie struktury z przeglądarki.

- Usunąć z Redux `sources[].content`, `rawHands` oraz pełne ręce z sesji.
- Przechowywać tylko rewizję, status, filtry, zaznaczenia, bieżące strony i mały cache otwartych rąk.
- Usunąć globalny `usePokerMetrics`.
- Selektory mają pobierać konkretne pola, nie całe `state.poker`.
- Zachować cache analiz AI, zapisane ręce i ustawienia modelu.
- Usunąć akcje włączania/wyłączania źródeł oraz klientowe czyszczenie kanonicznej bazy.
- Na `409` odświeżyć dataset i pokazać informację o konieczności ponowienia działania.

Nie przebudowywać jeszcze wyglądu widoków.

## Zadanie 10 — Centrum importu

Przekształcić zakładkę źródeł w centrum importu:

- upload jednego TXT;
- „Sprawdź katalog inbox”;
- pasek/faza postępu;
- bieżąca liczba unikalnych rąk;
- historia importów;
- liczniki nowych, duplikatów, konfliktów i błędów;
- status „zakończono z ostrzeżeniami”;
- informacja o ręcznym `git status`, commit i push.

Nie dodawać usuwania ani wyłączania zaimportowanych źródeł.

## Zadanie 11 — Sesje, ręce i Replayer

- Widoki Cash i Turnieje pobierają podsumowania sesji z API.
- Ręce są dociągane stronami po 100 podczas scrollowania.
- Użyć `@tanstack/react-virtual`; zachować obecny wygląd przewijanej listy.
- Replayer pobiera szczegół jednej ręki po kliknięciu.
- Analiza pojedynczej ręki i sesji wysyła wyłącznie ID i rewizję.
- Poprzednie analizy oznaczać jako nieaktualne według fingerprintu.
- Nie trzymać pełnych rąk po zamknięciu Replayera poza małym ograniczonym cache.

## Zadanie 12 — Profil, przeciwnicy, karty i wallet

- Każdy widok pobiera własny agregat dopiero po otwarciu.
- Zachować obecne filtry dat i Cash/Turniej.
- Przeciwnicy pozostają stronicowani.
- Karty otrzymują gotowe 169 agregatów, nie pełną listę rąk.
- Wallet otrzymuje gotową serię maksymalnie 1200 punktów.
- Usunąć klientowe skanowanie wszystkich rąk i powielone liczenie metryk.

## Zadanie 13 — Code splitting i usunięcie starej ścieżki

- Zakładki, Replayer i Recharts ładować przez `React.lazy`.
- Usunąć stare endpointy zwracające pełne TXT dopiero po migracji wszystkich widoków.
- Usunąć nieużywany kod pełnego przeliczania w Redux.
- Dodać cache, staging i `data/inbox/*.txt` do `.gitignore`.
- Ignorować zmiany danych pokerowych w watcherze Vite.
- Uzupełnić README o migrację, inbox, centrum importu, konflikty, odbudowę cache i ręczny Git workflow.

## Punkt kontrolny C — Końcowe testy i wydajność

Dopiero po zakończeniu wszystkich zmian:

```powershell
npm test
npm run lint
npm run build
npm run perf:data
```

`perf:data` ma używać obecnego dużego datasetu i raportować:

- czas zimnego indeksowania;
- czas startu z cache;
- liczbę rąk i sesji;
- rozmiar bootstrapu API;
- rozmiar początkowego chunku JS;
- maksymalną liczbę punktów wykresu.

Kryteria:

- bootstrap API poniżej 1 MB;
- początkowy JS poniżej 120 kB gzip;
- cached startup backendu poniżej 200 ms;
- zimny indeks obecnych danych poniżej 3 s;
- wykres maksymalnie 1200 punktów;
- w DOM około 30 widocznych kafelków, niezależnie od długości sesji;
- przeglądarka nie pobiera pełnych TXT ani JSONL;
- pamięć przeglądarki spada co najmniej o 60%;
- po migracji liczba kanonicznych ID zgadza się z raportem dry-run.

Jeśli budżet nie jest spełniony, profilować konkretny etap. Nie dodawać kolejnych `useMemo` ani `React.memo` bez wykazanego wąskiego gardła.
