# Pełne usunięcie błędnie rozpoznanych rozdań i zabezpieczenie analiz AI

## Podsumowanie

- Usunąć wszystkie dane treningowe pochodzące z 18 zidentyfikowanych rozdań, nie tylko pojedyncze błędne spoty.
- Obejmuje to obecnie 26 ćwiczeń, wszystkie ich klucze, rozwiązania i analizy AI.
- Usunąć wszystkie powiązane próby; obecnie istnieje jedna — dla `#108986300029`.
- Zachować źródłowe historie rozdań poza modułem ćwiczeń.
- Nie uruchamiać ponownej analizy AI ani automatycznie nie uzupełniać zwolnionych miejsc.

## Zadania implementacyjne

1. **Autorytatywne fakty o kartach**
   - Lokalnie wyliczać dla każdej decyzji gotowy układ Hero, liczbę kart każdego koloru w ręce i na boardzie, liczbę kart pozostałych do wyłożenia oraz stan koloru: `made`, `draw`, `backdoor_draw` lub `none`.
   - Dla `#108986300029` wyliczyć na riverze `HIGH_CARD`, cztery widoczne piki, zero kart do wyłożenia i `flushStatus: none`.
   - Obliczenia mogą wykorzystywać wyłącznie stan dostępny przed analizowaną decyzją.

2. **Uszczelnienie kontraktu AI**
   - Podnieść kontrakt nowych kluczy do v3 i wysyłać `decisionCardFacts` jako autorytatywną część każdego spotu.
   - W prompcie jednoznacznie wskazać, że cztery karty jednego koloru nie tworzą flusha, a trzy nie są bezpośrednim flush drawem.
   - Wymagać zwrotu `madeHand` i `flushStatus`; odrzucać klucz niezgodny z lokalnymi wyliczeniami.
   - Odrzucać również uzasadnienia przypisujące Hero niemożliwy kolor lub draw, nie blokując poprawnych opisów zakresu przeciwnika.
   - Odrzucony klucz nie może aktywować ćwiczenia ani służyć do oceniania odpowiedzi.

3. **Usunięcie całych 18 rozdań z ćwiczeń**
   - Jednorazowy audyt wskazuje 18 błędnie rozpoznanych `handId`.
   - Dla każdego z nich usunąć wszystkie spoty ze wszystkich typów ćwiczeń i ulic — obecnie łącznie 26.
   - Usunąć wszystkie ich klucze, rozwiązania, analizy AI oraz identyfikatory z wybranej puli i referencji skanowania.
   - Zapisać wykluczenie według `handId` i fingerprintu, aby zwykły skan lub przebudowa nie odtworzyły tych ćwiczeń.
   - Zmieniona wersja źródłowego rozdania z nowym fingerprintem może być w przyszłości ponownie dopuszczona.
   - Pozostałe poprawne klucze v2 zachować po lokalnym audycie.

4. **Usunięcie prób i naprawa sesji**
   - Trwale usunąć każdą próbę wskazującą na dowolny spot z tych 18 rozdań; obecnie jest jedna.
   - Usunąć powiązane identyfikatory z `availableSpotVersionIds`, `answeredSpotVersionIds`, bieżącego i ostatniego spotu wszystkich sesji.
   - Przeliczyć wyniki sesji wyłącznie z zachowanych prób.
   - Aktywną sesję kontynuować, jeśli pozostały poprawne pytania; w przeciwnym razie zakończyć ją bez wystawiania brakujących ocen.

5. **Brak automatycznej regeneracji**
   - Nie zastępować usuniętych 26 ćwiczeń nowymi kandydatami.
   - Nie dodawać ich do kolejki odświeżania i nie wykonywać płatnych zapytań AI.
   - Status i liczniki ćwiczeń mają od razu odzwierciedlić zmniejszoną pulę.

## Interfejsy i dane

- Kontrakt AI v3 otrzyma `decisionCardFacts` z `madeHand`, `flushStatus`, `cardsToCome` i licznikami kolorów.
- Klucze v3 będą przechowywać potwierdzone fakty oraz wersję walidacji.
- Stan treningu otrzyma wersję audytu i listę wykluczonych par `handId`–fingerprint.
- Bez nowych endpointów HTTP i bez usuwania kanonicznych historii rozdań.

## Testy

- Regresja dla `#108986300029`: Hero nie ma koloru, a odpowiedź zalecająca value raise zostaje odrzucona.
- Prawdziwy flush, bezpośredni draw, backdoor draw, trzy karty koloru oraz cztery karty na riverze.
- Walidator odrzuca sprzeczne fakty i opis Hero, ale dopuszcza kolor w zakresie przeciwnika.
- Migracja usuwa wszystkie 26 ćwiczeń i kluczy pochodzących z 18 rozdań.
- Żadne inne ćwiczenie z tych samych `handId` nie pozostaje w kolekcji.
- Wszystkie powiązane próby znikają z historii i statystyk, a sesje mają przeliczone wyniki.
- Ponowny skan nie odtwarza wykluczonych rozdań, nie uzupełnia wakatów i nie uruchamia AI.
- Na końcu uruchomić testy treningowe, pełny `npm test`, lint i build.

## Założenia

- „Usunięcie rozdania” dotyczy wszystkich jego danych w module ćwiczeń, niezależnie od tego, czy część kluczy wygląda poprawnie.
- Źródłowe rozdania pozostają dostępne w zwykłej historii i replayerze.
- Pozostałe analizy nie są masowo regenerowane.
