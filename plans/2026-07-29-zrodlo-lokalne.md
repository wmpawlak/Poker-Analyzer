# Automatyczne źródła z lokalnego katalogu `data`

## Cel

Przy starcie aplikacja automatycznie wczytuje pliki `.txt` z `poker-analyzer/data`, pokazuje je jako „Lokalne” w zakładce „Wgrane pliki” i nadaje im pierwszeństwo przed ręcznymi źródłami.

## Zadanie 1 — Lokalny serwer i API

- Dodać serwer Node uruchamiający frontend Vite oraz lokalne API.
- `GET /api/local-sources` zwraca nazwę, rozmiar i datę modyfikacji plików `.txt`.
- `GET /api/local-sources/:filename/content` zwraca zawartość wskazanego pliku.
- Skanować wyłącznie główny poziom katalogu `data`.
- Blokować inne rozszerzenia, podkatalogi i próby wyjścia poza `data`.
- Brak katalogu zwraca pustą listę, a błąd odczytu bezpieczny komunikat.
- Ustawić:
  - `npm run dev` dla Vite wraz z API,
  - `npm start` dla zbudowanej aplikacji wraz z API.

Kryterium ukończenia: oba endpointy działają, a serwer nie udostępnia plików spoza `data`.

## Zadanie 2 — Model i synchronizacja źródeł

- Rozszerzyć źródło o:
  - `origin: "local" | "upload"`,
  - `size`,
  - `modifiedAt`.
- Dodać asynchroniczną akcję synchronizacji lokalnych źródeł.
- Przy starcie pobrać metadane i zawartość wszystkich lokalnych plików.
- Podczas kolejnej synchronizacji:
  - dodać nowe pliki,
  - zastąpić zmienione,
  - usunąć nieistniejące już na dysku,
  - zachować stan `enabled` istniejących źródeł.
- Dodać `localSourcesStatus` i `localSourcesError`.
- Awaria API nie może blokować ręcznego uploadu.

Kryterium ukończenia: obecne dwa pliki z `data` automatycznie pojawiają się w Redux i zasilają analizy.

## Zadanie 3 — Priorytet i deduplikacja rozdań

- Przetwarzać najpierw aktywne źródła lokalne, następnie ręczne.
- Parsować źródła oddzielnie i deduplikować rozdania po ID ręki.
- Przy duplikacie zachowywać rękę z lokalnego źródła.
- Nie podwajać statystyk, sesji ani turniejów po ręcznym wgraniu tej samej historii.
- Rebuy pozostawić poza mechanizmem deduplikacji źródeł.

Kryterium ukończenia: ta sama ręka obecna lokalnie i w ręcznym pliku jest liczona dokładnie raz.

## Zadanie 4 — Automatyczne uruchomienie synchronizacji

- Przy pierwszym uruchomieniu interfejsu wywołać synchronizację katalogu `data`.
- Nie uruchamiać jej ponownie przy zwykłych renderach.
- Pokazać stan ładowania do zakończenia pobierania i parsowania.
- Po błędzie pozostawić działającą aplikację oraz możliwość ręcznego uploadu.

Kryterium ukończenia: po otwarciu aplikacji dane lokalne są dostępne bez wybierania pliku.

## Zadanie 5 — Widok „Wgrane pliki”

- Oznaczyć źródła etykietą „Lokalny” albo „Wgrany ręcznie”.
- Wyświetlić rozmiar oraz datę modyfikacji.
- Dodać przycisk „Odśwież dane lokalne”.
- Pokazać stan ładowania i komunikat błędu API.
- Dla lokalnych plików pozostawić „Włącz/Wyłącz”, ale ukryć kosz.
- Kosz zachować wyłącznie dla źródeł wgranych ręcznie.

Kryterium ukończenia: użytkownik jednoznacznie rozpoznaje pochodzenie źródła i nie może przypadkowo usunąć pliku z dysku.

## Zadanie 6 — Testy automatyczne

- Test API:
  - lista zawiera tylko `.txt`,
  - odczyt poprawnego pliku działa,
  - próba traversal i inne rozszerzenie są odrzucane.
- Test synchronizacji:
  - nowe i zmienione pliki,
  - pliki usunięte z katalogu,
  - zachowanie `enabled`,
  - obsługa niedostępnego API.
- Test deduplikacji i pierwszeństwa lokalnej ręki.
- Test zachowania ręcznego uploadu po błędzie lokalnego odczytu.
- Uruchomić `npm test`, build i ESLint zmienionych plików.

Kryterium ukończenia: wszystkie nowe testy i build przechodzą bez prawdziwych wywołań Gemini.

## Zadanie 7 — Smoke test

- Uruchomić aplikację z obecnymi dwoma plikami w `data`.
- Potwierdzić ich oznaczenie jako „Lokalne”.
- Sprawdzić dane Cash i turniejowe.
- Wyłączyć jedno źródło i potwierdzić przeliczenie aplikacji.
- Dodać testowy plik i użyć ręcznego odświeżenia.
- Potwierdzić brak podwojenia wyników po ręcznym wgraniu tej samej historii.

## Założenia

- Pliki w `data` pozostają źródłem prawdy; osobna baza danych nie jest potrzebna.
- Synchronizacja działa przy starcie i po użyciu przycisku, bez stałego obserwowania katalogu.
- Wyłączenie lokalnego pliku jest zachowywane podczas synchronizacji, ale resetuje się po pełnym ponownym uruchomieniu.
- Aplikacja nigdy nie usuwa lokalnych plików z dysku.
