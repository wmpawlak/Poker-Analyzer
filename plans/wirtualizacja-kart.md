# Wirtualizacja kart sesji — plan zadań

## Cel i zasady realizacji

- Ograniczyć liczbę kart sesji montowanych w rozwiniętym miesiącu do elementów widocznych i niewielkiego bufora.
- Zastosować rozwiązanie w Cash, Turniejach oraz „Analizie wielu sesji”.
- Nie zmieniać endpointów, payloadów, cache Redux, zaznaczeń ani sposobu pobierania miesięcy.
- Wirtualizować miesiące zawierające ponad 30 sesji; mniejsze listy renderować tradycyjnie.
- Zachować sticky nagłówki, jeden wspólny scrollbar, obsługę klawiatury oraz możliwość zwinięcia wszystkich miesięcy.
- Nie wykonywać prawdziwych wywołań AI ani modyfikować istniejących zmian w `data/`.

## Zadanie 1 — Komponent wirtualnej listy sesji

Zakres: nowy `src/components/VirtualSessionList.jsx`.

1. Zbudować komponent na `@tanstack/react-virtual` z interfejsem:

   - `sessions`,
   - `renderSession`,
   - `scrollElementRef`,
   - `ariaLabel`,
   - `resetKey`.

2. Konfiguracja:

   - `overscan: 6`,
   - szacowana wysokość wiersza: 104 px,
   - stabilny klucz z `session.id`,
   - rzeczywisty pomiar przez `virtualizer.measureElement`.

3. Wykorzystać zewnętrzny kontener przewijania akordeonu. Nie tworzyć wewnętrznego scrollbara.

4. Wyliczać `scrollMargin` jako pozycję początku listy względem kontenera akordeonu:

   - ponownie po zmianie aktywnego miesiąca,
   - po zmianie liczby lub kolejności sesji,
   - po zmianie rozmiaru kontenera,
   - po renderze mogącym zmienić wysokość nagłówków.

5. Każdy wirtualny element opakować w:

   - `role="listitem"`,
   - wrapper mierzony przez `measureElement`,
   - odstęp 10 px wliczony do mierzonej wysokości.

6. Kontener listy otrzymuje `role="list"`, nazwę miesiąca i możliwość uzyskania fokusu, aby można go było przewijać klawiaturą.

### Punkt kontrolny 1

Dodać test jednostkowy z kontrolowanym viewportem i mockiem `ResizeObserver`.

Sprawdzić:

- lista 100 sesji montuje mniej niż 30 kart,
- pierwsze elementy są widoczne na początku,
- przewinięcie montuje końcowe elementy i usuwa początkowe,
- zmienna wysokość kart aktualizuje pozycje bez nakładania,
- zmiana `resetKey` usuwa pomiary poprzedniego miesiąca,
- klucze sesji pozostają stabilne po zmianie kolejności.

Nie przechodzić dalej, dopóki test komponentu nie przejdzie deterministycznie bez pomiarów czasu.

## Zadanie 2 — Integracja z miesięcznym akordeonem

Zakres: `src/components/SessionMonthAccordion.jsx`.

1. Dodać referencję do obecnego kontenera `overflow-y-auto` i przekazać ją do wirtualnej listy.

2. Dla poprawnie załadowanej, niepustej strony:

   - do 30 sesji użyć zwykłego renderowania,
   - powyżej 30 sesji użyć `VirtualSessionList`.

3. Nie wirtualizować komunikatów:

   - loading,
   - error i retry,
   - pusty miesiąc.

4. Zachować bez zmian:

   - `renderSession`,
   - `aria-expanded` i `aria-controls`,
   - jeden otwarty miesiąc,
   - możliwość pozostawienia wszystkich miesięcy zwiniętych,
   - fokus wracający do nagłówka po zwinięciu,
   - sticky nagłówki i licznik wybranych sesji.

5. Przy zmianie miesiąca nie resetować globalnego scrolla akordeonu do początku. Nowa lista ma rozpocząć pomiar od pierwszej sesji względem klikniętego nagłówka.

### Punkt kontrolny 2

Rozszerzyć testy akordeonu o:

- tradycyjne renderowanie 30 sesji,
- wirtualizację 31 sesji,
- maksymalnie jeden `role="region"`,
- zwinięcie wirtualizowanego miesiąca do zera kart,
- przełączenie na drugi miesiąc bez pozostawienia kart poprzedniego,
- zachowanie fokusu, Enter, Spacji, loadingu i retry.

## Zadanie 3 — Regresje Cash, Turniejów i Analizy wielu sesji

1. Zweryfikować Cash i Turnieje:

   - rozwinięcie miesiąca nadal wywołuje tylko jedno pobranie,
   - pierwsza widoczna karta może zostać wybrana,
   - wybranie sesji nadal pobiera szczegóły, wykres i pierwszą stronę rąk,
   - przewinięcie do sesji spoza początkowego viewportu pozwala ją otworzyć,
   - sortowanie datą lub wynikiem resetuje układ wirtualizatora i pokazuje właściwy początek listy,
   - statusy analiz oraz ich przyciski działają po ponownym zamontowaniu karty.

2. Zweryfikować „Analizę wielu sesji”:

   - zaznaczenie sesji trwa po jej odmontowaniu i ponownym pojawieniu się,
   - nagłówki nadal pokazują pełne liczniki wyboru,
   - przyciski analizy pojedynczej sesji działają na wirtualnych kartach,
   - „Zaznacz widoczne” może nawodnić wszystkie miesiące, ale nie zwiększa liczby kart w DOM,
   - preview otrzymuje wszystkie wybrane ID, nie tylko aktualnie zamontowane.

3. Nie dodawać specjalnych ścieżek w widokach. Integracja ma pozostać przez wspólny `SessionMonthAccordion`.

### Punkt kontrolny 3

Uruchomić:

1. testy miesięcznego akordeonu,
2. testy Cash i Turniejów,
3. testy analizy wielu sesji,
4. testy zaznaczeń i raportów historycznych.

Żaden test nie może wykonywać prawdziwego wywołania modelu AI.

## Zadanie 4 — Duży test strukturalny i dostępność

Zakres: `test/session-months-structural.test.js` oraz syntetyczna fixture.

1. Zmienić dotychczasowe oczekiwanie „100 kart aktywnego miesiąca w DOM” na:

   - liczba większa od zera,
   - liczba mniejsza niż 30,
   - dokładna liczba nie jest kryterium, ponieważ zależy od viewportu i pomiaru wysokości.

2. Sprawdzić katalog 12 × 100 sesji:

   - początkowo wszystkie miesiące są zwinięte i nie ma kart,
   - rozwinięcie pobiera tylko jeden miesiąc,
   - przewinięcie umożliwia dotarcie do pierwszej i ostatniej sesji,
   - zmiana miesiąca nie zwiększa liczby kart,
   - pełne nawodnienie 1200 sesjami nie montuje zamkniętych miesięcy,
   - ponowne otwarcie korzysta z cache.

3. Sprawdzić semantykę:

   - poprawne `role="list"` i `role="listitem"`,
   - jednoznaczna nazwa wirtualnej listy,
   - przewijanie kontenera klawiaturą,
   - interaktywne elementy karty zachowują fokus po kliknięciu,
   - zwinięcie przenosi fokus na nagłówek miesiąca.

4. Nie stosować pomiarów milisekund jako kryterium testu.

### Punkt kontrolny 4

Na viewporcie testowym około 600–900 px lista 100–160 sesji powinna utrzymywać orientacyjnie 15–25 kart w DOM i nigdy przekraczać 30.

## Zadanie 5 — Dokumentacja i końcowa weryfikacja

1. Uzupełnić README:

   - miesiące powyżej 30 sesji są wirtualizowane,
   - pełne dane miesiąca pozostają w cache,
   - wirtualizacja ogranicza DOM, ale nie zmniejsza payloadu API.

2. Jeśli przeglądarka będzie dostępna, sprawdzić ręcznie:

   - Cash, maj 2026 — 141 sesji,
   - Analiza wielu sesji, maj 2026 — 160 sesji,
   - płynne przewinięcie od pierwszej do ostatniej karty,
   - sticky nagłówek i zwijanie po przewinięciu,
   - brak dodatkowego scrollbara,
   - zachowanie na wąskim viewporcie.

3. Jeśli przeglądarka pozostanie niedostępna, odnotować kontrolę wizualną jako jedyny punkt manualny, bez zastępowania jej deklaracją powodzenia.

## Końcowa weryfikacja

Uruchomić kolejno:

1. Nowy test `VirtualSessionList`.
2. Testy miesięcznego akordeonu.
3. Testy Cash i Turniejów.
4. Testy „Analizy wielu sesji”.
5. Duży test strukturalny.
6. Pełne `npm test`.
7. ESLint wyłącznie dla zmienionych plików, bez `--fix`.
8. `npm run build`.
9. `git diff --check`.
10. Porównać `git status --short -- data` sprzed i po testach.

Jeżeli testy dopiszą dane do `data/poker`, zatrzymać weryfikację i zgłosić dokładne pliki. Nie przywracać ani nie usuwać danych bez jawnej zgody użytkownika.

## Założenia

- Próg wirtualizacji: 30 sesji.
- Bufor: 6 elementów przed i za viewportem.
- Szacowana wysokość początkowa: 104 px, później zastępowana rzeczywistym pomiarem.
- Brak zmian w backendzie, Redux i kontraktach API.
- Optymalizacja pamięci cache Redux pozostaje osobnym zadaniem.
