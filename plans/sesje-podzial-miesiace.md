# Implementacja miesięcznych, leniwie ładowanych list sesji

## Cel i zasady realizacji

- Zastosować wspólny mechanizm miesięcznego akordeonu w Cash, Turniejach i „Analizie wielu sesji”.
- Na wejściu pobierać indeks miesięcy oraz listę sesji wyłącznie najnowszego miesiąca.
- Utrzymywać maksymalnie jeden rozwinięty miesiąc i montować w DOM tylko jego karty.
- Nie zmieniać obliczeń statystyk, metryk sesji, wykresów, rozdania, raportów AI ani danych przekazywanych do analiz.
- Zachować istniejące niezacommitowane zmiany w `data/`. Testy nie mogą wykonywać prawdziwych wywołań AI ani modyfikować cache analiz.

## Zadanie 1 — Kontrakt miesięcy i zapytania backendowe

Rozszerzyć warstwę zapytań danych oraz routing API.

1. Dodać `GET /api/session-months` z parametrami:

   - `gameType=cash|tournament|both`,
   - `handRanking`,
   - `dateFrom`,
   - `dateTo`.

2. Odpowiedź endpointu:

   ```json
   {
     "datasetRevision": "...",
     "gameType": "cash",
     "handRanking": "",
     "dateFrom": "",
     "dateTo": "",
     "availableRanks": [],
     "months": [
       {
         "key": "2026-08",
         "year": 2026,
         "month": 8,
         "sessionCount": 12,
         "handCount": 840,
         "matchingHandCount": 840,
         "cashSessionCount": 12,
         "tournamentSessionCount": 0
       }
     ]
   }
   ```

3. Reguły agregacji:

   - Klucz miesiąca wyznaczać z kanonicznego `session.dateStr`, nie przez konwersję strefy czasowej.
   - Miesiące zwracać od najnowszego.
   - Pomijać rebuy przy liczbach rozdań.
   - `availableRanks` liczyć po typie gry i zakresie dat, ale przed zastosowaniem `handRanking`, zgodnie z obecnym zachowaniem.
   - Przy aktywnym `handRanking` uwzględniać tylko sesje mające przynajmniej jedno pasujące rozdanie.
   - `handCount` oznacza wszystkie prawdziwe rozdania zakwalifikowanych sesji, a `matchingHandCount` rozdania pasujące do filtra.

4. Rozszerzyć `GET /api/sessions` o opcjonalny `month=YYYY-MM`:

   - z `month` zwracać tylko sesje danego miesiąca,
   - bez `month` zachować obecny pełny kontrakt,
   - miesiąc przecinać z `dateFrom/dateTo`,
   - odrzucać niepoprawny format miesiąca kodem `DATA_INVALID_QUERY`.

5. Dodać `POST /api/session-summaries/query`:

   ```json
   {
     "datasetRevision": "...",
     "sessionIds": ["id-1", "id-2"]
   }
   ```

   Odpowiedź zawiera lekkie `toSessionSummary` w kolejności żądania oraz `missingSessionIds`. Endpoint służy wyłącznie do rozwiązywania bezpośrednich odnośników i źródeł historycznych raportów; nie zwraca metryk, wykresów, rozdań ani `rawText`.

### Punkt kontrolny 1

Dodać testy zapytań i API obejmujące:

- sesje z dwóch stron granicy miesiąca,
- mieszane Cash/Turnieje,
- zakres dat przecinający część miesiąca,
- filtr układu i poprawne `matchingHandCount`,
- pomijanie rebuys,
- pusty miesiąc i pusty dataset,
- błędny `month`,
- zgodność starego `/api/sessions` bez `month`,
- brak ciężkich danych w nowych odpowiedziach,
- `DATASET_REVISION_MISMATCH` i brakujące ID w zapytaniu zbiorczym.

Nie przechodzić dalej, dopóki nowe testy API i obecne `data-api` nie przejdą.

## Zadanie 2 — Miesięczny cache i thunki Redux

Zastąpić założenie jednej pełnej `currentPages[gameType].items` strukturą katalogu miesięcznego.

1. Dodać:

   - indeksy miesięcy według bazowego klucza zapytania,
   - strony miesięczne według bazowego klucza i `month`,
   - globalną mapę lekkich podsumowań sesji po ID.

2. Bazowy klucz musi zawierać:

   - `gameType`,
   - `handRanking`,
   - `dateFrom`,
   - `dateTo`.

3. Dodać thunki:

   - `fetchSessionMonths`,
   - `fetchSessionMonth`,
   - `fetchAllSessionsForQuery`,
   - `fetchSessionSummariesByIds`.

4. `fetchAllSessionsForQuery` używa wariantu `/api/sessions` bez miesiąca, a następnie dzieli wynik na miesięczne strony. Jest uruchamiany wyłącznie przez operacje wymagające pełnej wiedzy:

   - globalny filtr statusu analizy,
   - „Zaznacz widoczne” w analizie wielu sesji.

5. Zachowanie cache:

   - nie pobierać ponownie poprawnie załadowanego miesiąca dla tej samej rewizji i zapytania,
   - po zwinięciu zachować dane, ale nie komponenty,
   - po zmianie `datasetRevision` wyczyścić indeksy i strony,
   - chronić stan kluczami zapytań przed spóźnionymi odpowiedziami,
   - przerwane lub stare żądanie nie może nadpisać aktywnego filtra,
   - oddzielić błąd indeksu od błędu konkretnego miesiąca.

6. Zachować dotychczasowy cache szczegółów sesji i stronicowanych rozdań.

### Punkt kontrolny 2

Testy reducera i thunków z zamockowanym `fetch`:

- indeks i najnowszy miesiąc są niezależnymi żądaniami,
- dwa równoległe miesiące nie nadpisują się,
- ponowne otwarcie nie wysyła drugiego żądania,
- pełne pobranie poprawnie nawadnia wszystkie miesięczne strony,
- zmiana rewizji unieważnia cache,
- stara odpowiedź po zmianie filtra jest ignorowana,
- błąd jednego miesiąca nie usuwa innych,
- zbiorcze rozwiązanie ID zapisuje istniejące sesje i zgłasza brakujące.

## Zadanie 3 — Wspólny komponent miesięcznego akordeonu

Dodać współdzielony komponent używany przez oba widoki sesji.

1. Komponent otrzymuje:

   - deskryptory miesięcy,
   - aktywny `monthKey`,
   - stan i dane strony miesiąca,
   - callback rozwinięcia/zwinięcia,
   - funkcję renderującą właściwy typ karty sesji,
   - opcjonalną liczbę zaznaczonych sesji w miesiącu.

2. Zachowanie:

   - tylko jeden miesiąc może być rozwinięty,
   - tylko rozwinięty miesiąc renderuje karty,
   - kliknięcie rozwiniętego nagłówka zwija miesiąc,
   - nagłówek jest `position: sticky` w przewijanym panelu,
   - po zwinięciu zachować fokus i dopilnować, aby nagłówek pozostał widoczny,
   - każdy nagłówek ma `aria-expanded`, `aria-controls` i jednoznaczną nazwę,
   - Enter i Spacja działają tak samo jak kliknięcie.

3. Wygląd nagłówka:

   - polska nazwa miesiąca generowana po stronie klienta przez `Intl.DateTimeFormat('pl-PL')`,
   - rok, liczba sesji i rozdań,
   - podział Cash/Turnieje w widoku mieszanym,
   - liczba zaznaczonych sesji w analizie wielu sesji,
   - chevron, spinner, błąd z akcją ponowienia.

4. Nie pokazywać miesięcznego zysku, aby nie wprowadzać nowej interpretacji wyników turniejowych.

### Punkt kontrolny 3

Dodać testy interakcyjne komponentu. Jeżeli obecne testy SSR nie pozwalają wiarygodnie sprawdzić kliknięć i fokusu, dodać `jsdom` jako zależność wyłącznie developerską i użyć `react-dom/test-utils`/`act`, bez dodawania biblioteki runtime.

Sprawdzić:

- rozwinięcie, zwinięcie i przełączanie miesięcy,
- maksymalnie jeden panel z kartami w DOM,
- obsługę klawiatury i atrybuty ARIA,
- zachowanie fokusu,
- loading, error, retry i pusty miesiąc,
- brak ponownego callbacku ładowania po otwarciu danych z cache.

## Zadanie 4 — Migracja Cash i Turniejów

Przebudować `SessionBrowserView` na miesięczny katalog.

1. Po wejściu:

   - pobrać indeks miesięcy,
   - automatycznie otworzyć najnowszy miesiąc,
   - pobrać tylko jego sesje,
   - wybrać pierwszą sesję według aktywnego sortowania, jeśli nie ma poprawnego wcześniejszego wyboru.

2. Sortowanie:

   - miesiące zawsze od najnowszego,
   - data/wynik i rosnąco/malejąco sortują sesje wyłącznie wewnątrz otwartego miesiąca,
   - zmienić opis kontrolki na „Sortuj sesje w miesiącu”, aby zakres był jednoznaczny.

3. Filtry:

   - zmiana `handRanking` pobiera nowy indeks i najnowszy pasujący miesiąc,
   - zmiana statusu analizy uruchamia `fetchAllSessionsForQuery`, aby zachować globalne działanie filtra,
   - po pełnym filtrowaniu ukryć miesiące bez pasujących sesji i otworzyć najnowszy niepusty.

4. Wybór sesji:

   - zwinięcie jej miesiąca nie usuwa wybranej sesji ani prawego panelu,
   - jeżeli wybrana sesja przestaje pasować do filtra, wybrać pierwszą z najnowszego pasującego miesiąca,
   - bezpośrednie przejście z innego widoku najpierw rozwiązuje ID przez lekkie zapytanie, następnie otwiera właściwy miesiąc,
   - nie zastępować takiego bezpośredniego wyboru automatycznie najnowszą sesją.

5. Zakładki „Z analizą” i „Zapisane” oraz wirtualizowana lista rozdań pozostają bez zmian.

### Punkt kontrolny 4

Testy integracyjne widoku:

- pierwszy render wywołuje indeks i tylko najnowszy miesiąc,
- nie wywołuje pełnego `/api/sessions`,
- przełączenie miesiąca usuwa poprzednie karty z DOM,
- ponowne otwarcie korzysta z cache,
- sortowanie działa wyłącznie wewnątrz miesiąca,
- filtr statusu wykonuje pełne pobranie dopiero po zmianie kontrolki,
- automatyczny wybór i bezpośrednie przejście wskazują poprawną sesję,
- statusy aktualnej/nieaktualnej analizy nadal działają,
- szczegóły, wykres i rozdania pobierają się jak wcześniej.

## Zadanie 5 — Migracja „Analizy wielu sesji”

1. Użyć jednego indeksu miesięcy dla aktywnego `gameType` i zakresu dat.

2. Po wejściu otworzyć i pobrać najnowszy miesiąc. Kandydatów UI budować wyłącznie z załadowanych stron, ale nie usuwać wyborów z miesięcy zwiniętych.

3. Zmiana filtrów:

   - usuwa z wyboru tylko sesje faktycznie niespełniające nowego typu gry lub zakresu dat,
   - nie usuwa wyboru dlatego, że jego miesiąc nie jest aktualnie zamontowany,
   - otwiera najnowszy pasujący miesiąc.

4. „Zaznacz widoczne”:

   - pobiera pełną listę dla aktywnych filtrów,
   - nawadnia miesięczne cache,
   - zaznacza wszystkie sesje zgodne z filtrami,
   - nie rozwija ani nie montuje wszystkich miesięcy,
   - dotychczasowe warunki uruchomienia raportu pozostają bez zmian.

5. Nagłówki miesięcy pokazują liczbę zaznaczonych sesji, dzięki czemu wybór z innych miesięcy jest widoczny po ich zwinięciu.

6. Podgląd i analiza:

   - `sessionIds`, preview, aktualność raportów źródłowych i wywołania AI pozostają bez zmian,
   - wybór sesji w innym miesiącu nadal aktualizuje ten sam podgląd grupowy,
   - uruchamianie analizy pojedynczej sesji z wiersza pozostaje możliwe.

7. Raporty historyczne:

   - dla źródeł spoza załadowanych miesięcy użyć `POST /api/session-summaries/query`,
   - brak sesji lub zmiana fingerprintu nadal oznacza nieaktualne źródło,
   - samo oglądanie raportu historycznego nie może pobierać wszystkich miesięcy.

### Punkt kontrolny 5

Testy integracyjne:

- zaznaczenia utrzymują się po zmianie miesiąca,
- nagłówki pokazują poprawne liczniki,
- „Zaznacz widoczne” dociąga pełny zakres i zaznacza sesje z wielu miesięcy,
- w DOM nadal znajduje się tylko otwarty miesiąc,
- filtry typu i dat poprawnie czyszczą wyłącznie niepasujące wybory,
- preview otrzymuje wszystkie wybrane ID niezależnie od otwartego miesiąca,
- statusy raportów i analiza pojedynczej sesji działają jak wcześniej,
- raport historyczny sprawdza źródła przez lekkie zapytanie,
- żaden test nie wykonuje rzeczywistego ani płatnego wywołania modelu.

## Zadanie 6 — Regresje, dokumentacja i pomiar strukturalny

1. Zaktualizować README o:

   - miesięczny indeks,
   - leniwe doczytywanie,
   - znaczenie sortowania wewnątrz miesiąca,
   - pełne pobranie uruchamiane przez filtr statusu i „Zaznacz widoczne”.

2. Dodać dużą syntetyczną fixture, np. 12 miesięcy po 100 sesji, ale nie mierzyć czasu testu jako kryterium — byłoby niestabilne.

3. Na tej fixture sprawdzić strukturalnie:

   - pierwsze żądania nie pobierają 1200 sesji,
   - początkowy DOM zawiera wyłącznie karty najnowszego miesiąca,
   - przełączanie nie zwiększa liczby zamontowanych kart,
   - pełne pobranie z operacji globalnej nie powoduje zamontowania zamkniętych miesięcy.

4. Wykonać kontrolę wizualną desktopu i wąskiego viewportu:

   - długi miesiąc można zwinąć z przyklejonego nagłówka po przewinięciu na dół,
   - nagłówki nie zasłaniają filtrów,
   - focus i scroll nie skaczą poza panel,
   - licznik wyborów jest czytelny,
   - loading i błędy nie zmieniają gwałtownie szerokości panelu.

## Końcowa weryfikacja

Uruchomić kolejno:

1. Nowe testy zapytań miesięcznych i API.
2. Testy Redux miesięcznego cache.
3. Testy komponentu akordeonu.
4. Testy Cash/Turniejów.
5. Testy analizy wielu sesji i raportów historycznych.
6. Pełne `npm test`.
7. Lint zmienionych plików, bez automatycznego przepisywania kodu.
8. `npm run build`.
9. `git diff --check`.
10. `git status --short` i kontrolę, że istniejące zmiany w `data/` nie zostały zmodyfikowane.

Gotowe, gdy wszystkie dotychczasowe funkcje działają, pierwszy render pobiera i montuje tylko najnowszy miesiąc, a liczba kart w DOM nie rośnie podczas przeglądania kolejnych miesięcy.
