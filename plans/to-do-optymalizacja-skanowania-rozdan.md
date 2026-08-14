# Przyrostowe i wznawialne skanowanie rozdań

## Podsumowanie

Zastąpić produkcyjne `scanCanonicalHands` skanem działającym w workerze, automatycznie po 250 rekordów. Każdy skan nadal lekko przejdzie przez wszystkie ID i fingerprinty, aby poprawnie wykrywać usunięcia, ale pokerowa ekstrakcja zostanie wykonana wyłącznie dla nowych, zmienionych, przywróconych lub wymagających ponownej ekstrakcji rozdań.

Skan nie może wczytywać, klonować ani zapisywać pełnej 355-megabajtowej kolekcji. Bieżąca aktywna pula pozostaje niezmieniona aż do atomowej finalizacji.

## Kamień milowy 1 — trwały stan i porcjowany odczyt

1. Podnieść wersję schematu SQLite i dodać:

   - `training_scan_jobs` ze statusem, fazą, rewizją datasetu, kursorem, licznikami, błędem i datami;
   - `training_scan_candidates` przechowującą jedynie ID, fingerprint, klasyfikację zmiany i lokalizację rekordu — bez `rawText`;
   - `sources.last_seen_scan_id` do wykrywania rozdań nieobecnych po pełnym przebiegu;
   - logiczną blokadę modyfikacji kanonicznego datasetu, współdzieloną przez skan, import i oficjalne narzędzie zastępowania rozdania;
   - indeksy po statusie zadania, `scan_id` i `last_seen_scan_id`.

2. Dodać strumieniowy czytnik JSONL w [dataRepository.js](C:/Users/Wojtek/Desktop/Projekty/Poker-Analyzer/server/dataRepository.js):

   - stała porcja produkcyjna: 250 rekordów;
   - kursor: plik, numer linii i offset bajtowy;
   - brak `readFile()` całych plików i brak tablicy wszystkich rekordów;
   - stabilna kolejność plików zapisana w zadaniu;
   - walidacja `handId`, `contentHash` i duplikatów.

3. Dodać repozytoryjne operacje SQL do utworzenia, pobrania, zatrzymania, wznowienia i anulowania skanu. Żadna z nich nie może używać `getFullTrainingSnapshot`, `clone(collection)`, `transact` ani `persistFullCollection`.

## Kamień milowy 2 — przyrostowy silnik skanowania

4. Zbudować usługę skanu oraz dedykowany worker:

   - główny proces pozostaje responsywny;
   - worker pobiera kolejne 250 rekordów;
   - przed parsowaniem pokera porównuje `contentHash` z `sources.fingerprint`;
   - niezmienione rekordy dostają tylko znacznik `last_seen_scan_id`;
   - ciężka ekstrakcja dotyczy wyłącznie kandydatów nowych, zmienionych, przywróconych lub ze starszą wersją ekstraktora.

5. Po każdej porcji zatwierdzać osobną krótką transakcję zawierającą kursor, postęp i listę kandydatów. `Stop` oznacza dokończenie bieżącej porcji i przejście do `stopped`.

6. Po pełnym przebiegu uruchamiać w workerze nieprzerywalną fazę `finalizing`:

   - ponownie zweryfikować rewizję datasetu;
   - w jednej transakcji przetworzyć kandydatów i zapisać tylko ich źródła, spoty oraz lokalne klucze equity;
   - oznaczyć jako usunięte źródła niewidziane w tym skanie;
   - archiwizować wyłącznie wersje dotkniętych rozdań;
   - unieważniać suplementy i derived spoty tylko dla zmienionych źródeł;
   - zachować istniejące klucze, próby, sesje i historię zgodnie z obecną semantyką;
   - usunąć staging, przebudować aktywną pulę i zwolnić blokadę dopiero przy udanym `COMMIT`.

7. Przebudowę selekcji wykonać z lekkiej projekcji SQL: identyfikatory, typ ćwiczenia, pozycja, stack, liczba rywali, etap i daty. Nie odczytywać `payload_json` ani pełnych pytań dla wszystkich 32 tys. spotów.

## Kamień milowy 3 — sterowanie, blokady i UI

8. Zmienić publiczne API:

   - `POST /api/training/refresh/scan` zwraca `202` i uruchomione `scanJob`;
   - `GET /api/training/refresh/scan/:id` zwraca postęp;
   - `POST .../:id/stop`, `.../:id/resume`;
   - `POST .../:id/cancel` wymaga `{ confirmed: true }`;
   - status treningu zawiera `scanJob`, `resumableScanJob`, `trainingLocked` i `importsLocked`.

9. Statusy zadania: `running`, `stop_requested`, `stopped`, `finalizing`, `completed`, `failed`, `invalidated`, `cancel_requested`, `cancelled`. Publiczny postęp zawiera fazę, `processedHands`, `totalHands`, `candidateHands`, procent, aktualny plik i błąd.

10. Zastosować blokady serwerowe:

   - podczas `running`, `stop_requested` i `finalizing` ćwiczenia zwracają `423 TRAINING_SCAN_IN_PROGRESS`;
   - po `stopped` lub `failed` ćwiczenia działają na starej aktywnej puli;
   - import, skan inboxu i oficjalne zastępowanie rozdania są zablokowane dla każdego niezakończonego skanu;
   - zadania AI, aktywacja equity, reset i drugi skan nie mogą działać równolegle ze skanem;
   - po restarcie niedokończony skan przechodzi do `stopped` i czeka na ręczne wznowienie;
   - bezpośrednia zewnętrzna zmiana plików powoduje `invalidated`; wymagane jest anulowanie i nowy skan.

11. W ustawieniach pokazywać pasek postępu, fazę oraz przyciski Stop/Wznów/Anuluj. Podczas finalizacji wyłączyć Stop i Anuluj. W ćwiczeniach oraz centrum importu wyświetlać konkretny komunikat o blokadzie zamiast nieskończonego ładowania.

12. Po potwierdzeniu zgodności usunąć produkcyjne powiązanie `scanCanonicalHands` z pełnym `transact`. Stara implementacja może pozostać wyłącznie jako pomocniczy model zgodności w testach, ale nie może być osiągalna z API SQLite.

## Testy i kryteria akceptacji

- Migracja aktualnej bazy zachowuje wszystkie spoty, klucze, sesje i próby.
- Testy semantyczne obejmują: nowe, niezmienione, zmienione, przywrócone, usunięte, odrzucone i audytowo wykluczone rozdania oraz zmianę wersji ekstraktora.
- Stop zapisuje dokładny kursor; wznowienie nie powtarza zatwierdzonych porcji ani nie tworzy duplikatów.
- Anulowanie usuwa staging, zachowuje poprzednią pulę i zwalnia blokady.
- Błąd lub restart przed `COMMIT` finalizacji pozostawia starą pulę bez częściowych zmian.
- Import jest blokowany podczas skanu i pauzy; ćwiczenia są blokowane podczas pracy, ale działają po pauzie.
- Test integracyjny API sprawdza `202`, polling, Stop, Wznów, Anuluj i kody konfliktów.
- Test UI sprawdza postęp, komunikaty blokad oraz brak nieskończonego spinnera.
- Test wydajnościowy na co najmniej 19 tys. rekordów potwierdza porcje maksymalnie 250 i brak pełnego snapshotu.
- Ręczny benchmark na obecnej bazie: skan niezmienionego datasetu nie przekracza około 350 MiB RSS, a endpoint statusu pozostaje responsywny poniżej 1 sekundy.
- Testy uruchamiać grupami po ukończeniu warstwy repozytorium, następnie API/UI; na końcu pełny test, lint i build.

## Ustalone założenia

- Nie stosujemy porcji procentowych: 10% obecnie oznacza około 1934 rozdania i rośnie wraz z datasetem.
- Pełne wykrywanie usunięć wymaga lekkiego przejścia przez wszystkie rekordy.
- Porcja 250 jest stałą serwerową, a w testach może być wstrzykiwana mniejsza wartość.
- Skan działa automatycznie do końca; nie pyta użytkownika po każdej porcji.
- Pauza odblokowuje stare ćwiczenia, ale nie import.
- Wznowienie po restarcie jest wyłącznie ręczne.
- Bezpośrednie ręczne edytowanie plików JSONL poza aplikacją pozostaje poza gwarancją blokady, ale zostanie wykryte przez kontrolę rewizji przed finalizacją.
