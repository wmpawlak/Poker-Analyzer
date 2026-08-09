# Poprawa wykrywania sesji turniejowych

## Podsumowanie

Turnieje będą grupowane według dokładnego numeru z nagłówka, np. `86617`, niezależnie od zmiany daty o północy. Na aktualnych danych liczba sesji spadnie ze 104 do prawidłowych 102; turnieje `56152` i `86617` staną się pojedynczymi sesjami.

## Zadania implementacyjne

1. **Identyfikacja sesji**
   - W `buildTourneySessions` użyć `tourneyId` jako klucza grupowania zamiast `tourneyId + data`.
   - Zachować rozdzielenie turniejów o tej samej nazwie, ale różnych numerach.
   - Rozdania bez identyfikatora nadal pozostawiać rozdzielone, bez ryzykownego łączenia.
   - Dodać do scalonej sesji wewnętrzną listę `mergedFromSessionIds` zawierającą jej wcześniejsze identyfikatory dzienne.
   - Dla turniejów jednodniowych zachować dotychczasowy identyfikator sesji, aby nie unieważniać poprawnych raportów. Dla wielodniowych użyć stabilnego `tourney_<tourneyId>`.

2. **Przeliczenie scalonej sesji**
   - Zachować chronologiczną kolejność rozdań, ciągłe `sessionHandIndex`, wykrywanie rebuyów, wykres stacka, wynik oraz pierwszy i ostatni czas całego turnieju.
   - Nie zmieniać grupowania sesji Cash ani parsera numeru turnieju.

3. **Selektywne usunięcie niepełnych analiz**
   - Podczas przeliczania źródeł usunąć z Redux i `poker_ai_session_analyses_v1` raporty przypisane do dziennych fragmentów wymienionych w `mergedFromSessionIds`.
   - Usunąć również raporty z `poker_ai_session_group_analyses_v1`, które odwołują się do któregokolwiek z tych fragmentów.
   - Zachować analizy innych sesji oraz wszystkie analizy pojedynczych rozdań.
   - Jeżeli użytkownik miał zaznaczony fragment, przełączyć wybór na nową scaloną sesję. Usunięty raport zbiorczy ma zniknąć również z aktualnego wyboru UI.
   - Cache keys i format nowych raportów pozostają bez zmian; czyszczenie nastąpi automatycznie przy synchronizacji lub ponownym przeliczeniu źródeł.

## Testy i weryfikacja

4. **Jedna końcowa faza testów**
   - Test parsera: ten sam `tourneyId` na dwóch datach tworzy jedną sesję ze wszystkimi rozdaniami.
   - Test rozdzielenia: jednakowa nazwa z różnymi numerami nadal tworzy różne sesje.
   - Test kompatybilności: jednodniowy turniej zachowuje identyfikator i istniejącą analizę.
   - Test cleanupu: analizy fragmentów i zależne raporty wielu sesji są usuwane z Redux oraz `localStorage`; raporty niezwiązane ze scaleniem pozostają.
   - Test zaznaczenia, indeksów rozdań, wyniku, rebuyów i zakresu czasu po scaleniu.
   - Uruchomić testy celowane, następnie pełne `npm test`, build i `git diff --check`.
   - Wykonać diagnostykę na aktualnym pliku: oczekiwane 102 sesje oraz po jednej sesji dla `56152` (109 rozdań) i `86617` (121 rozdań).
   - Zachować wszystkie istniejące lokalne i nieśledzone zmiany w repozytorium.
