# Przebudowa UI „Analiza wielu sesji” — plan dla Terra Reasoning Mid

## Zasady realizacji

- Zachować wszystkie obecne niezacommitowane zmiany. Nie resetować ani nie nadpisywać zmian użytkownika.
- Nie zmieniać endpointów AI, promptów ani kontraktów raportów.
- Nie wykonywać prawdziwych ani płatnych wywołań AI podczas testów.
- Testy uruchamiać tylko w punktach kontrolnych wskazanych poniżej — gdy ich wynik jest potrzebny przed kolejnym zadaniem.
- Pełny zestaw testów, build i lint uruchomić dopiero na końcu.

## Zadanie 1 — Rozdzielenie sesji widocznych i gotowych do wspólnej analizy

Zakres: `src/utils/sessionGroupCandidates.js`.

- Zachować `buildSessionGroupCandidates` jako funkcję zwracającą tylko sesje posiadające najnowszy aktualny raport AI. Ta funkcja nadal zabezpiecza wspólną analizę.
- Dodać pomocniczą funkcję dla UI, która zwraca wszystkie sesje z prawdziwymi rozdaniami po zastosowaniu:
  - filtra Wszystko/Cash/Turnieje,
  - zakresu dat,
  - dotychczasowego sortowania od najnowszej sesji.
- Każdy wiersz UI ma zawierać dotychczasowe metadane sesji oraz jeden status:
  - `current` — istnieje aktualny raport, sesję można zaznaczyć,
  - `missing` — brak raportu,
  - `stale` — raport istnieje, ale nie odpowiada aktualnym danym sesji.
- Nie traktować starego raportu jako gotowego źródła wspólnej analizy.
- Nie zmieniać kontraktu `sourceId`, fingerprintów ani sposobu filtrowania dat.

### Punkt kontrolny 1

Dodać i uruchomić wyłącznie testy `session-group-candidates` obejmujące:

- sesję z aktualnym raportem,
- sesję bez raportu,
- sesję ze starym raportem,
- filtry kategorii i dat,
- potwierdzenie, że istniejący builder nadal zwraca wyłącznie aktualne raporty.

Nie przechodzić dalej, dopóki te testy nie przejdą, ponieważ UI będzie zależało od nowej struktury danych.

## Zadanie 2 — Obsługa analizy pojedynczej sesji na liście

Zakres: `src/components/SessionGroupAnalysisView.jsx`.

- Pobrać ze stanu Redux:
  - `sessionAnalysisStatusById`,
  - `sessionAnalysisErrorById`.
- Zaimportować i wykorzystać istniejący thunk `analyzeSessionWithAI`.
- Dla statusu `current`:
  - pokazać checkbox,
  - pozwolić zaznaczyć sesję do wspólnej analizy,
  - nie pokazywać przycisku ponownej analizy.
- Dla statusu `missing`:
  - zablokować zaznaczanie,
  - pokazać „Analizuj sesję”.
- Dla statusu `stale`:
  - zablokować zaznaczanie,
  - pokazać informację „Analiza nieaktualna” oraz „Analizuj ponownie”.
- Przycisk ma wysyłać:
  - `sessionId`,
  - pełne prawdziwe rozdania danej sesji,
  - `gameType` równy `cash` albo `tournament`.
- Podczas analizy danego wiersza zastąpić jego przycisk spinnerem i tekstem „Analizowanie…”.
- Pozwolić uruchamiać analizy kilku różnych sesji równolegle. Blokować tylko ponowne uruchomienie tej samej sesji.
- Błąd pokazywać wyłącznie przy odpowiednim wierszu, razem z przyciskiem ponowienia.
- Przy kodzie `AI_INCOMPLETE_RESPONSE` jasno oznaczyć, że ponowienie jest nowym płatnym żądaniem.
- Po sukcesie sesja ma przejść do statusu `current`, ale nie może zostać automatycznie zaznaczona.
- Nie tworzyć nowego thunka ani endpointu. Udany raport zostanie zsynchronizowany do repozytoryjnego cache przez istniejący listener Redux.

### Punkt kontrolny 2

Uruchomić tylko testy związane z:

- stanem analizy sesji w Redux,
- wyrenderowaniem wierszy `current`, `missing`, `stale`, `loading` i `failed`,
- równoległym uruchomieniem analiz dwóch różnych sesji,
- brakiem automatycznego zaznaczenia po sukcesie,
- brakiem prawdziwych wywołań dostawcy AI — `fetch` ma być zamockowany.

Ten punkt musi przejść przed przebudową layoutu, żeby błędów zachowania nie pomylić później z błędami CSS.

## Zadanie 3 — Uproszczenie nagłówka i filtrów

Zakres: `src/components/SessionGroupAnalysisView.jsx` i `src/App.jsx`.

- Usunąć z lewej kolumny:
  - opis „Wybierz co najmniej dwie sesje…”,
  - „Wróć do profilu”,
  - liczniki Dostępne/Cash/Turnieje/Zaznaczone.
- Usunąć prop `onBack` z komponentu i z jego wywołania w `App`.
- Zachować filtry Wszystko/Cash/Turnieje.
- Zakres dat ma wyłącznie filtrować listę. Nie może automatycznie zaznaczać sesji.
- Przycisk „Wyczyść zakres” zastąpić małym przyciskiem zawierającym tylko ikonę:
  - dodać `aria-label="Wyczyść zakres dat"`,
  - dodać tooltip przez `title`,
  - pozostawić blokadę, gdy obie daty są puste.
- Zachować kompaktowe akcje „Zaznacz widoczne” i „Wyczyść wybór”.
- „Zaznacz widoczne” ma zaznaczać wyłącznie widoczne sesje ze statusem `current`.
- Zmiana filtra lub dat nadal usuwa z wyboru sesje, które przestały być widoczne.

Nie uruchamiać jeszcze testów — kolejne zadanie przebuduje ten sam fragment layoutu.

## Zadanie 4 — Naprawa przewijanej listy i przycisku wspólnej analizy

Zakres: `src/components/SessionGroupAnalysisView.jsx`.

- Lewą kolumnę zbudować jako:
  1. nierozciągliwy panel filtrów,
  2. listę zajmującą pozostałą wysokość,
  3. nierozciągliwy panel końcowej akcji.
- Lista sesji musi mieć:
  - `min-height` pozwalające zobaczyć kilka wierszy,
  - `flex: 1`,
  - `overflow-y: auto`,
  - własny scrollbar,
  - ograniczoną wysokość na mniejszych ekranach.
- Nie nakładać na listę dodatkowego kontenera z obramowaniem, który ponownie zmniejszy jej wysokość.
- Nagłówek listy zmienić na krótkie „Sesje”.
- Każdy wiersz ma czytelnie pokazywać:
  - nazwę,
  - Cash/Turniej,
  - datę,
  - liczbę rozdań,
  - status raportu,
  - checkbox albo akcję analizy.
- Dolny panel ma zawierać jeden główny przycisk „Analizuj wybrane sesje”.
- Usunąć stałe teksty:
  - „Wybierz co najmniej dwie różne sesje…”,
  - informację o jednym potencjalnie płatnym żądaniu,
  - informację o niezapisywaniu niepełnego raportu.
- Gdy wspólna analiza trwa, spinner i tekst ładowania mają znaleźć się wewnątrz tego samego przycisku.
- Przycisk ma być nieaktywny, gdy:
  - wybrano mniej niż dwie gotowe sesje,
  - model nie jest skonfigurowany,
  - zakres dat jest błędny,
  - dane podglądu nie są jeszcze gotowe,
  - trwa wspólna analiza.
- Błędy wspólnej analizy i problem konfiguracji modelu pokazywać warunkowo w małym komunikacie bez rozbudowywania całego panelu.

Nie uruchamiać jeszcze testów — następne zadanie kończy przebudowę całego workspace’u.

## Zadanie 5 — Poszerzenie kafelków raportu i dopracowanie prawego panelu

Zakres: `src/components/SessionGroupAnalysisView.jsx`.

- Zachować prawy panel „Podgląd i raport analizy”, historię raportów oraz lokalny podgląd metryk.
- Zachować osobne jednostki ekonomiczne Cash i Turniejów.
- Sekcje `CategoryInsights` układać zawsze pionowo, po jednej na wiersz.
- Usunąć desktopową siatkę dzielącą Cash i Turnieje na dwie kolumny.
- Żółty kafelek „Turnieje” i niebieski kafelek „Cash” mają zajmować całą szerokość obszaru raportu.
- Przyciski źródeł i rozdań mają zawijać się wewnątrz pełnej szerokości kafelka.
- Prawy panel ma zachować własny pionowy scroll.
- Na desktopie cały workspace ma wykorzystać dostępną wysokość aplikacji.
- Na węższym ekranie kolumny mają układać się pionowo, bez utraty dostępu do listy lub raportu.

### Punkt kontrolny 3

Uruchomić:

- test UI widoku wielu sesji,
- test na brak usuniętych tekstów i licznika,
- test ikonowego czyszczenia zakresu,
- test obecności pojedynczego głównego przycisku,
- test, że sekcje kategorii nie używają dwukolumnowego layoutu,
- kontrolę wizualną działającej aplikacji dla desktopu oraz węższego viewportu.

Sprawdzić ręcznie:

- czy lista ma widoczny obszar i własny scroll,
- czy można zaznaczać checkboxy,
- czy przyciski analizy sesji nie są zasłonięte,
- czy żółty kafelek zajmuje pełną szerokość prawego panelu.

Jeżeli kontrola wizualna wykryje problem, poprawić layout i powtórzyć tylko ten punkt kontrolny.

## Zadanie 6 — Porządki i dokumentacja

- Usunąć nieużywane importy, propsy i zmienne pozostałe po starym layoutcie.
- Zaktualizować README:
  - lista pokazuje także sesje bez aktualnego raportu,
  - tylko aktualne raporty można wybrać do wspólnej analizy,
  - brakujące raporty można uruchamiać bezpośrednio z listy,
  - kilka analiz pojedynczych sesji może działać równolegle.
- Nie zmieniać dokumentacji niezwiązanej z tym widokiem.
- Sprawdzić `git diff`, aby upewnić się, że nie zmodyfikowano backendu, kontraktów AI ani istniejącego pliku cache poza zmianami generowanymi przez aplikację.

Nie uruchamiać osobnego zestawu testów — pełna weryfikacja nastąpi w ostatnim zadaniu.

## Zadanie 7 — Końcowa weryfikacja

Dopiero po ukończeniu wszystkich zmian uruchomić:

1. Testy kandydatów sesji.
2. Testy UI analizy wielu sesji.
3. Testy Redux/cache analiz.
4. Pełne `npm test`.
5. Lint zmienionych plików.
6. `npm run build`.
7. `git diff --check`.

Końcowo potwierdzić:

- lista jest czytelna i przewijana,
- zakres dat działa jako filtr,
- tylko aktualne raporty można zaznaczyć,
- sesje bez raportu mają przycisk i loader,
- równoległe analizy różnych sesji działają,
- sukces nie zaznacza sesji automatycznie,
- wspólna analiza ma jeden główny przycisk,
- kafelki Cash i Turnieje zajmują pełną szerokość,
- testy nie wykonały płatnych wywołań,
- raporty nadal synchronizują się do `data/poker-ai-analyses-v1.json`,
- wszystkie wcześniejsze lokalne zmiany użytkownika pozostały zachowane.
