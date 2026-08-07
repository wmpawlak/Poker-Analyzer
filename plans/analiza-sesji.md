# Analiza AI całej sesji — plan zadań

## Zasada realizacji

Zadania 1–6 obejmują implementację bez uruchamiania po każdym kroku pełnych testów, linta ani buildu. Testy dopisujemy zbiorczo w zadaniu 7, a całą weryfikację wykonujemy jednorazowo w zadaniu 8. Istniejących zmian użytkownika w `data/*.txt` nie modyfikujemy.

## Zadanie 1: Kontrakt analizy sesji

- Dodać wspólny kontrakt wejścia, odpowiedzi, promptu i walidacji analizy sesji.
- Kompaktowe wejście ma zawierać wszystkie prawdziwe rozdania sesji, bez rebuy i bez pełnego `rawText`.
- Dla każdego rozdania przekazywać ID, czas, pozycję, blindy, stack, karty, board, wynik, kwoty, układ i linie akcji bez `SUMMARY`.
- Dodać deterministyczny odcisk całej zawartości sesji oraz wybór rozdania z największą bezwzględną zmianą wyniku.
- Ustawić limit wejścia na 1 500 000 bajtów. Nie wolno po cichu skracać ani próbkować sesji.
- Zdefiniować odpowiedź:
  - `profileStyleId`;
  - `sessionSummary`;
  - `keyMistakes` — maksymalnie 5 błędów, każdy z opisem, korektą i 2–3 ID przykładów;
  - `notableHands` — maksymalnie 5 unikalnych rozdań.
- Walidować zgodność stylu z lokalnym klasyfikatorem, przynależność wszystkich ID do sesji, powtarzalność błędów i obecność największego swingu.

## Zadanie 2: Backend i wywołanie modelu

- Dodać serwis sesyjny korzystający z istniejących modeli i adapterów Gemini/OpenAI.
- Rozszerzyć adapter OpenAI o wybór nazwy ścisłego schematu; analiza rozdania zachowuje dotychczasowy schemat, a sesja używa `poker_session_analysis`.
- Prompt ma:
  - pisać po polsku i ograniczać podsumowanie do 2–4 zdań;
  - opisywać decyzje, a nie oceniać gry przez wynik;
  - traktować lokalne metryki i wynik CoinPoker jako fakty;
  - ignorować `RETURN` jako inwestycję;
  - porządkować błędy według powtarzalności i znaczenia;
  - stosować ostrożny język przy małej próbie.
- Dodać `POST /api/ai/analyze-session`.
- Odpowiedź endpointu ma zawierać model, `sessionId`, odcisk sesji i zwalidowaną analizę.
- Każde uruchomienie wykonuje najwyżej jedno wywołanie dostawcy. Bez retry, automatycznej zmiany modelu i częściowego wyniku.
- Zwracać osobne, czytelne błędy dla nieprawidłowej sesji, przekroczonego limitu, brakującego klucza i wadliwej odpowiedzi AI.

## Zadanie 3: Redux, cache i historia

- Dodać thunk `analyzeSessionWithAI`, korzystający z bieżącego modelu domyślnego.
- Dodać cache `poker_ai_session_analyses_v1`, niezależny od historii pojedynczych rozdań.
- Zapisywać raporty według `sessionId` jako historię zawierającą:
  - `reportId`;
  - model i datę;
  - liczbę rozdań;
  - odcisk sesji;
  - wynik analizy.
- Prowadzić stan ładowania i błędu osobno dla każdej sesji.
- Wynik zapisywać według danych zwróconych przez thunk, a nie aktualnego zaznaczenia, aby zmiana sesji podczas żądania nie pomyliła raportów.
- Domyślnie wybierać najnowszy raport zgodny z aktualnym odciskiem.
- Zachować nieaktualne raporty w historii i oznaczać je jako wygenerowane dla wcześniejszego zestawu danych.
- Rozszerzyć `clearData` o usuwanie historii analiz sesji.

## Zadanie 4: Panel analizy sesji

- Dodać zwarty panel AI przeznaczony wyłącznie dla konkretnej sesji.
- Obsłużyć stany:
  - brak raportu i przycisk „Analizuj sesję”;
  - nieskonfigurowany model;
  - generowanie;
  - błąd;
  - aktualny raport;
  - historyczny, nieaktualny raport.
- Pokazać model, datę oraz selektor historii analogiczny do analizy pojedynczego rozdania.
- Wyświetlić:
  - krótkie podsumowanie stylu;
  - maksymalnie 5 błędów z praktyczną korektą i przykładami;
  - maksymalnie 5 ważnych rozdań z uzasadnieniem.
- Dla sesji poniżej 30 rozdań pokazywać widoczne ostrzeżenie o niskiej wiarygodności, ale nie blokować analizy.
- Linki do przykładów mają otwierać istniejący Replayer. Jeżeli rozdanie ze starego raportu nie jest już dostępne, link pozostaje nieaktywny z odpowiednim komunikatem.

## Zadanie 5: Integracja z widokami sesji

- Rozszerzyć istniejące „Podsumowanie sesji” o opcjonalne miejsce na panel AI nad kartami metryk.
- Włączyć panel w widoku Cash i turniejów.
- Przekazywać zawsze pełne rozdania aktualnej sesji; filtr układów i sortowanie listy nie mogą zmieniać zakresu analizy.
- Do otwierania ważnych rozdań wykorzystać obecny callback Replayera.
- Nie dodawać analizy sesji do zbiorczego „Raportu profilu Hero”.
- Analiza sesji nie generuje automatycznie analiz pojedynczych rozdań i nie wymaga ich wcześniejszego istnienia.

## Zadanie 6: Dokumentacja użytkowa

- Uzupełnić README o analizę sesji, historię raportów, użycie domyślnego modelu i limit jednego żądania.
- Wyjaśnić, że raport uruchamia się ręcznie, a krótkie sesje mają ograniczoną wiarygodność.
- Zaznaczyć, że zbyt duża sesja nie będzie analizowana częściowo.
- Zachować zasadę, że testy automatyczne nigdy nie wykonują płatnych wywołań.

## Zadanie 7: Zbiorcze dopisanie testów

- Kontrakt wejścia:
  - komplet rozdań;
  - pomijanie rebuy;
  - brak wpływu filtrów;
  - stabilny odcisk;
  - największy swing;
  - limit bajtów.
- Walidacja odpowiedzi:
  - maksymalnie 5 elementów;
  - zgodność stylu;
  - prawidłowe i unikalne ID;
  - minimum dwóch przykładów powtarzalnego błędu;
  - obowiązkowy największy swing.
- API i adaptery:
  - dokładnie jedno mockowane wywołanie;
  - brak retry;
  - nieznany lub nieskonfigurowany model;
  - przekroczony limit;
  - wadliwa odpowiedź dostawcy.
- Redux i cache:
  - dopisywanie historii;
  - prawidłowe przypisanie po zmianie zaznaczenia;
  - aktualny i nieaktualny odcisk;
  - ponowienie innym modelem;
  - czyszczenie danych.
- UI:
  - wszystkie stany panelu;
  - ostrzeżenie poniżej 30 rąk;
  - historia;
  - otwieranie właściwego rozdania;
  - brak panelu w raporcie profilu.

## Zadanie 8: Jednorazowa weryfikacja końcowa

- Uruchomić kolejno:
  - `npm test`;
  - `npm run lint`;
  - `npm run build`;
  - `git diff --check`.
- Jeżeli kontrola nie przejdzie, poprawić konkretny problem i najpierw ponowić tylko nieudaną kontrolę; pełny zestaw powtórzyć raz po zakończeniu poprawek.
- Wykonać browser smoke bez uruchamiania płatnego modelu: panel Cash i turniejowy, mała próba, historia z danymi testowymi oraz otwieranie Replayera.
- Prawdziwe płatne wywołanie pozostawić jako oddzielny, świadomy test ręczny użytkownika.

## Założenia

- V1 zawsze używa jednego żądania; analiza etapowa pozostaje poza zakresem.
- Raport może zawierać mniej niż 5 błędów lub ważnych rozdań.
- „Link” oznacza przycisk otwierający Replayer, ponieważ aplikacja nie ma adresów URL poszczególnych rozdań.
