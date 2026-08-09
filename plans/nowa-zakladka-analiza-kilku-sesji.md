# Przebudowa zakładki „Analiza wielu sesji”

## Podsumowanie

Audyt wykazał, że problem nie ogranicza się do pojedynczej klasy CSS. Obecny podwidok dokłada kolejne duże sekcje w jednym pionowym scrollu, ponownie montuje profil lokalny po zmianie wyboru i przekazuje wszystkie rozdania przez argument akcji Redux. Nowa wersja będzie osobną zakładką z dwukolumnowym obszarem roboczym.

## Zadania implementacyjne

1. **Wydzielić osobną zakładkę**
   - Dodać „Analiza wielu sesji” do sidebara i osobną gałąź `activeTab` w [App.jsx](C:/Users/WojciechPawlak/Desktop/Projekty/poker-analyzer/src/App.jsx).
   - Usunąć przycisk, lazy import i stan podwidoku z „Mojego profilu”.
   - Użyć czytelnej etykiety nagłówka zamiast technicznego identyfikatora zakładki.

2. **Zachować stan roboczy podczas nawigacji**
   - Przenieść do `App` niezależny stan: typ gry, daty, zaznaczone `sourceIds` i wybrany raport historyczny.
   - Stan przetrwa przejście do sesji źródłowej i innych zakładek, ale nie odświeżenie strony.
   - Zmiana filtrów lub danych usunie wyłącznie niewidoczne albo nieaktualne identyfikatory; usunięty raport historyczny wyczyści wybór raportu.
   - Filtry tej zakładki będą niezależne od filtrów „Mojego profilu”.

3. **Zbudować od nowa dwukolumnowy workspace**
   - Desktop: lewa kolumna z filtrami, licznikiem, listą sesji i stałą akcją; prawa z podglądem, historią i raportem.
   - Kontener zakładki otrzyma `h-full min-h-0 overflow-hidden`; każda kolumna własny kontrolowany scroll.
   - Lista sesji będzie `flex-1 min-h-0 overflow-y-auto`, a przycisk analizy pozostanie widoczny w stopce selektora.
   - Prawy panel pokaże właściwy pusty stan, jeśli nie wybrano dwóch sesji — bez generowania wysokiej pustej karty.
   - Poniżej breakpointu desktopowego kolumny przejdą w układ pionowy z ograniczoną wysokością listy i jednym przewijaniem strony.

4. **Uprościć podgląd lokalnych metryk**
   - Zastąpić automatycznie dokładany pełny `SessionSummary` kompaktowym paskiem: liczba sesji i rozdań, podział Cash/Turnieje, wiarygodność, VPIP, PFR, 3-bet i wynik.
   - Pełny profil lokalny otwierać na żądanie w panelu z ograniczoną wysokością i własnym scrollem; nie renderować go, gdy jest zamknięty.
   - Usunąć `key` zależny od wyboru, który obecnie ponownie montuje sekcję po każdym checkboxie.
   - Obliczenia metryk oprzeć na odroczonym wyborze, aby zaznaczanie pozostało płynne przy dużej liczbie rozdań.

5. **Odchudzić przepływ Redux**
   - Zmienić argument `analyzeSessionGroupWithAI` z `{ sources, ... }` na `{ sourceIds, activeCategory, dateRange }`.
   - W thunk odtworzyć aktualnych kandydatów z Redux, zweryfikować identyfikatory i dopiero wtedy zbudować kontrakt grupy.
   - Dzięki temu `meta.arg` nie będzie zawierać wszystkich rozdań i ostrzeżenia middleware nie będą maskowane przez wyłączanie kontroli serializowalności.
   - Zachować jedno ręczne żądanie, obecny fingerprint, walidację odpowiedzi, historię, brak automatycznych retry i brak wysyłania surowych historii do AI.

6. **Uporządkować raport i dokumentację**
   - Historia raportów pozostanie dostępna w nagłówku prawego panelu.
   - Po udanej analizie automatycznie wybrać nowy raport; raport dla innego wyboru pokazać jako nieaktualny.
   - Zachować linki do sesji i Replayera oraz bezpieczne wyłączenie niedostępnych źródeł.
   - Zaktualizować README: nowa lokalizacja zakładki, układ, zachowanie stanu i ręczny koszt analizy.

## Interfejsy

- Nowy identyfikator nawigacji: `session-group-analysis`.
- Kontrolowany stan widoku: `{ gameType, dateFrom, dateTo, selectedSourceIds, selectedReportId }`.
- Nowy argument thunka: `{ sourceIds, activeCategory, dateRange }`.
- `POST /api/ai/analyze-session-group`, kontrakt odpowiedzi, profile modeli i zapis historii pozostają bez zmian.

## Testy i kryteria akceptacji

- Testy nawigacji potwierdzą osobną pozycję sidebara i brak starego przycisku w profilu.
- Testy stanu sprawdzą zachowanie wyboru po zmianie zakładki oraz usuwanie tylko niewidocznych/nieaktualnych sesji.
- Test Redux potwierdzi brak `hands` i obiektów sesji w `meta.arg`, jedno wywołanie API i brak zapisu historii po błędzie.
- Testy widoku obejmą wybór 1, 2, 5 i wszystkich widocznych sesji, puste stany, historię, stan ładowania i błędy.
- Smoke test w przeglądarce dla desktopu i węższego viewportu potwierdzi brak dużej białej przestrzeni, stabilną wysokość obu paneli i niezależne przewijanie.
- Na końcu uruchomić testy celowane, pełne `npm test`, lint zmienionych plików, `npm run build` i `git diff --check`.
- Nie wykonywać rzeczywistych ani płatnych żądań OpenAI/Gemini.
