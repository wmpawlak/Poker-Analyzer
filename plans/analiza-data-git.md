# Współdzielony cache analiz AI w repozytorium

## Podsumowanie

Obecnie pliki historii rozdań w `/data` są śledzone przez Git, ale raporty AI są tylko w `localStorage` przeglądarki. Dodamy wersjonowany cache raportów w `/data`, aby po zwykłym `git commit` i `git push` były dostępne na innych maszynach.

Ustalenia:

- zapisujemy wszystkie raporty: pojedynczych rąk, sesji i wielu sesji;
- repozytorium jest prywatne;
- aplikacja zapisuje pliki, ale nie wykonuje automatycznie `git commit` ani `git push`;
- `localStorage` pozostaje lokalnym fallbackiem.

## Zmiany implementacyjne

1. Dodać plik `data/poker-ai-analyses-v1.json` z historiami:

   - `handAnalyses`;
   - `sessionAnalyses`;
   - `sessionGroupAnalyses`;
   - wersją formatu i datą aktualizacji.

   Raporty nie będą zawierały surowych historii rozdań, kluczy API ani sekretów.

2. Dodać backendowy magazyn raportów:

   - `GET /api/ai-analyses` — odczyt wspólnego cache;
   - endpoint synchronizacji/merge — zapis nowych raportów bez nadpisywania historii z innych maszyn;
   - endpoint cleanupu — usuwanie raportów starych fragmentów sesji po scaleniu turnieju;
   - zapis atomowy przez plik tymczasowy i rename;
   - walidacja formatu oraz deduplikacja po `reportId`.

3. Zmienić frontend:

   - przy starcie pobierać cache z `/data` przez backend i scalać go z `localStorage`;
   - przy pierwszym uruchomieniu wypchnąć lokalne, nieobecne jeszcze raporty do wspólnego cache;
   - po udanej analizie automatycznie zapisywać raport do pliku w `/data`;
   - po scaleniu sesji usuwać z repozytoryjnego cache raporty dziennych fragmentów i zależne raporty grupowe;
   - zachować lokalny raport, jeśli zapis repozytoryjny się nie powiedzie, ale pokazać użytkownikowi ostrzeżenie o braku synchronizacji;
   - nadal stosować fingerprinty, aby stare raporty nie były uznawane za aktualne.

4. Zaktualizować README o:

   - lokalnym i współdzielonym cache;
   - pierwszej migracji istniejących raportów z przeglądarki;
   - standardowym workflow `git add`, `git commit`, `git push`;
   - konieczności rozwiązywania ewentualnych konfliktów pliku cache jak zwykłego konfliktu Git.

## Testy i kryteria akceptacji

- raporty wszystkich trzech typów są zapisywane i odczytywane po restarcie;
- istniejące lokalne raporty są migrowane bez ponownego wywołania płatnego API;
- merge nie usuwa historii z innej maszyny;
- cleanup scalonych turniejów działa zarówno w Redux/localStorage, jak i w `/data`;
- błędny lub zbyt duży cache nie powoduje utraty lokalnych raportów;
- zapis raportu nie wykonuje dodatkowego wywołania dostawcy AI;
- testy API, magazynu plikowego i Redux;
- pełne `npm test`, `npm run build` oraz `git diff --check`.

## Założenia

Plik raportów będzie częścią zwykłego commita razem z plikami historii. Aplikacja przygotuje zmianę w katalogu `/data`, natomiast zatwierdzenie i wypchnięcie pozostanie kontrolowane przez standardowy workflow Git.
