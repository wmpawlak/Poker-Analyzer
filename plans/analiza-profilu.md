# Analiza AI statystyk gracza

## Podsumowanie

- W „Mój profil” powstaną podzakładki „Statystyki” i „Analizy AI”. Obecna „Analiza wielu sesji” pozostanie osobnym widokiem.
- Raport będzie oparty na lokalnie wyliczonych statystykach z wybranego typu gry i zakresu dat. Istniejące raporty sesji będą wyłącznie opcjonalnym materiałem uzupełniającym — ich brak nie zablokuje analizy ani nie uruchomi dodatkowych zapytań AI.
- Każde uruchomienie wykona jedno płatne żądanie, utworzy osobny raport historyczny i zachowa snapshot statystyk.
- Wszystkie istniejące selektory zakresu dat zastąpi wspólny komponent oparty na [`@daypicker/react` w trybie zakresu](https://daypicker.dev/selections/range-mode), z polską lokalizacją.

## Interfejsy i kontrakty

- Dodać `GET /api/player-analysis/preview?gameType&dateFrom&dateTo`, zwracający:
  - kryteria i faktyczny zakres danych,
  - liczbę rąk i sesji,
  - pełne metryki wspólne oraz osobne Cash/Turnieje,
  - styl i wiarygodność,
  - liczbę dostępnych oraz wykorzystanych raportów sesji,
  - `canAnalyze` i ostrzeżenie o małej próbie.
- Dodać `POST /api/ai/analyze-player` z `{ modelId, gameType, dateFrom, dateTo, datasetRevision }`. Serwer ponownie wylicza dane kanoniczne; frontend nie przesyła statystyk ani historii rąk.
- Raport AI zawiera:
  - zgodny z lokalnymi danymi `profileStyleId` i `reliabilityId`,
  - podsumowanie, maksymalnie 5 mocnych stron i 5 leaków z korektami,
  - dokładnie 3 priorytety treningowe z ćwiczeniami,
  - osobne sekcje Cash/Turnieje dla trybu „Wszystko”,
  - odwołania do konkretnych metryk i opcjonalne odwołania do raportów sesji.
- Rozszerzyć cache AI o `playerAnalyses`, scalany po `reportId`. Raport przechowuje kryteria, snapshot metryk, model, datę, fingerprint, rewizję datasetu, pokrycie źródeł i wynik AI.
- Zmienić filtry dat na `dateRanges.{profile,opponents,wallet,cards,sessionGroup}` oraz jedną akcję `setDateRange`. Profilowe statystyki i analiza AI współdzielą zakres profilu; pozostałe widoki są niezależne.
- Rozszerzyć nawigację do sesji o opcjonalny `reportId`, aby źródło raportu gracza otwierało dokładny raport sesji.

## Małe zadania implementacyjne

1. [x] **Zabezpieczenie bieżącej pracy**
   - Zanotować wynik istniejących testów profilu, cache i API.
   - Zachować wszystkie obecne niezacommitowane zmiany, szczególnie w `server/app.js`, `server/dataQueries.js` i Redux; bez resetowania plików danych.

2. [x] **Wspólny model zakresu dat**
   - Dodać bezpieczne konwersje `YYYY-MM-DD ↔ Date` w lokalnej strefie czasowej.
   - Przenieść stan do zakresów per widok i przepiąć istniejące zapytania bez zmiany serwerowej semantyki włącznych granic dnia.

3. [x] **Komponent kalendarza**
   - Zainstalować `@daypicker/react@^10.0.1` i zbudować dostępny `DateRangePicker`.
   - Pokazywać dwa miesiące na desktopie i jeden na mobile, polskie nazwy, blokadę przyszłych dat oraz presety: cała historia, 7/30/90 dni, bieżący miesiąc i bieżący rok.
   - Pierwszy klik ustawia wyłącznie lokalny początek; drugi zatwierdza i zamyka kalendarz. Preset i czyszczenie działają natychmiast; zamknięcie/Escape anuluje niepełny wybór.

4. [x] **Podmiana selektorów dat**
   - Użyć komponentu w Profilu, Analizie wielu sesji, Kartach i Wykresach.
   - Dodać widoczny selektor do Przeciwników, ponieważ ten widok otrzyma własny zakres.
   - Usunąć wszystkie pary natywnych `input type="date"`.

5. [x] **Builder danych analizy gracza**
   - Filtrować prawdziwe ręce dokładnie według typu i dat oraz wyliczać metryki istniejącym `calculateSessionMetrics`.
   - Dla „Wszystko” zachować wspólne statystyki zachowania, ale wynik i winrate przekazywać osobno dla Cash i Turniejów.
   - Wyliczyć faktyczny zakres, liczbę sesji, styl, wiarygodność oraz katalog dozwolonych odwołań do metryk.

6. [x] **Opcjonalne dowody z sesji**
   - Używać tylko aktualnych, poprawnie zwalidowanych raportów sesji w całości mieszczących się w okresie.
   - Wybrać maksymalnie 20 raportów równomiernie w czasie; nie preferować wyłącznie najnowszych.
   - Przekazywać skrócone podsumowania i leaki, bez surowych historii rąk. Zapisać pełne pokrycie: sesje w okresie, raporty dostępne i raporty użyte.

7. [x] **Kontrakt i walidacja AI**
   - Zbudować osobny prompt, JSON Schema, fingerprint i walidator analizy gracza.
   - Wymagać, aby każdy wniosek wskazywał dostarczoną metrykę; źródła sesyjne pozostają opcjonalne.
   - Odrzucać wymyślone metryki, źródła, niezgodny styl/wiarygodność oraz wspólny wynik ekonomiczny dla Cash i Turniejów.

8. [x] **Backend preview i analiza**
   - Podłączyć endpoint preview bez wywołania modelu.
   - Podłączyć analizę do obecnego wyboru modeli i adapterów, bez retry i bez fallbacku na inny model.
   - Blokować analizę poniżej 30 rąk; dla 30–99 zwracać ostrzeżenie, a od 100 pełną wiarygodność. Zachować obsługę konfliktu rewizji datasetu.

9. [x] **Cache i Redux**
   - Dodać historię analiz gracza do localStorage i wspólnego repozytoryjnego cache, z migracją starszego cache przez domyślne `playerAnalyses: []`.
   - Dodać preview, status/error analizy, wybrany raport i thunk wykonujący jedno żądanie.
   - Po sukcesie dopisać i automatycznie wybrać nowy raport; stare raporty zachować.

10. [x] **Profil: tworzenie analizy**
    - Dodać podzakładki oraz wspólny profilowy pasek typu gry i dat.
    - W „Analizy AI” pokazać preview: ręce, sesje, styl, wiarygodność, pokrycie raportami sesji i używany model.
    - Przycisk blokować przy niepoprawnym zakresie, mniej niż 30 rękach, braku skonfigurowanego modelu lub trwającym żądaniu. Retry po błędzie jasno oznaczyć jako nowe płatne żądanie.

11. [x] **Historia i raport**
    - Po lewej wyświetlić kafelki posortowane malejąco po `analyzedAt`; po prawej wybrany raport, a na mobile ułożyć sekcje pionowo.
    - Kafelek pokazuje typ i zakres, liczbę rąk, styl, wiarygodność, datę utworzenia, model i etykietę „dane zmienione”, jeśli rewizja jest starsza.
    - Raport renderuje źródłowe chipy metryk oraz klikalne raporty sesji. Niedostępne historyczne źródło pozostaje widoczne, ale nieaktywne.

12. [x] **Głębokie linkowanie do raportu sesji**
    - Przenieść wybór historycznego raportu sesji z lokalnego stanu panelu do kontrolowanego stanu Redux.
    - Nawigacja ze źródła wybiera Cash/Turniej, sesję i dokładny `reportId`; ręczna nawigacja nadal domyślnie pokazuje najnowszy aktualny raport.

13. [x] **Dokumentacja i porządki**
    - Opisać różnicę między analizą statystyk gracza a ręczną analizą wielu sesji, minimum próby, jedno płatne żądanie i opcjonalne źródła.
    - Usunąć stare komponenty pól dat oraz nieużywane akcje i selektory.

## Testy i kryteria akceptacji

- Builder/kontrakt: Cash, Turniej, Wszystko, włączne granice dat, brak rąk, 29/30/99/100 rąk, osobne jednostki wyników, poprawne fingerprinty i odrzucanie obcych źródeł.
- Dowody sesji: brak raportów nie blokuje analizy; stare lub częściowo nachodzące raporty są pomijane; limit 20 jest deterministyczny i równomierny.
- API: preview bez modelu, dokładnie jedno wywołanie modelu, brak retry, niepoprawny zakres, nieskonfigurowany model, niepełna odpowiedź i konflikt datasetu.
- Cache/Redux: migracja starego cache, scalanie po `reportId`, zachowanie wielu analiz tych samych kryteriów, synchronizacja i oznaczanie starszej rewizji.
- Kalendarz: pierwszy dzień nie zmienia filtra, drugi zatwierdza, zakres jednodniowy, presety, czyszczenie, Escape, klawiatura, mobile/desktop i brak przesunięcia dat przez UTC.
- UI: podzakładki, blokady przy małej próbie, kolejność kafelków, wybrane trzy dane, historyczny snapshot, źródła metryk i przejście do dokładnego raportu sesji.
- Regresja: wszystkie widoki używają niezależnych zakresów; istniejąca Analiza wielu sesji działa bez zmian funkcjonalnych.
- Końcowo: testy celowane, pełne `npm test`, lint zmienionych plików, `npm run build`, `git diff --check` i kontrola wizualna obu szerokości bez prawdziwych wywołań AI.

## Założenia

- Historia nie dostaje w v1 usuwania, porównywania raportów ani wykresu zmian; zachowane metadane umożliwią dodanie porównań później.
- „Dane zmienione” jest konserwatywne: pojawia się przy każdej różnicy `datasetRevision`, nawet jeśli zmiana dotyczyła innego okresu.
- Wynik finansowy jest kontekstem, nie kryterium jakości decyzji.
- Raport pozostaje dostępny po zmianie danych dzięki zapisanemu snapshotowi; brakujące źródła nie usuwają raportu.
- Profilem i jego analizą steruje ten sam typ gry i zakres, ale ustawienia dat pozostałych widoków są niezależne.

## Baseline zadania 1 — 2026-08-11

- Testy profilu, cache i API: `npm.cmd test -- test/profile-view-ui.test.js test/profile-report.test.js test/ai-redux-cache.test.js test/ai-analyses-cache.test.js test/data-api.test.js test/ai-api.test.js`.
- Wynik: 33 zaliczone, 0 nieudanych, 8 pominiętych (41 łącznie), czas 3,29 s.
- Przed rozpoczęciem potwierdzono istniejące niezacommitowane zmiany, w tym `server/app.js`, `server/dataQueries.js` i `src/store/pokerSlice.js`, oraz zmiany i pliki danych. Nie wykonano resetu, checkoutu ani modyfikacji tych plików.
