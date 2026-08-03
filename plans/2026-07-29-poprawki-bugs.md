# Plan napraw: filtrowanie układów i poprawny wynik analizy AI

## 1. Filtrowanie po końcowym układzie

- Przywrócić usunięte ustawianie `handRanking`.
- Normalizować wynik do identyfikatorów: wysoka karta, para, dwie pary, trójka, strit, kolor, full, kareta, poker oraz `Brak układu`.
- Fold, muck i nierozpoznany wynik przypisywać do `Brak układu`.
- Filtr Cash/Turnieje najpierw ogranicza sesje, a następnie rozdania w otwartej sesji; rebuy jest pomijany.
- Jeśli otwarta sesja znika, automatycznie wybrać pierwszy pasujący wynik według bieżącego sortowania.
- Wykres pozostaje wykresem całej wybranej sesji.

## 2. Deterministyczne ustalanie zwycięzcy

- Parsować linię Hero wyłącznie z sekcji `*** SUMMARY ***`, zamiast pierwszego globalnego `Seat … Hero`.
- `and won` oraz `collected` ustawiają `outcome: WON`; `and lost` ustawia `LOST`, a fold `FOLDED`.
- Z tej samej linii odczytywać kwotę wygranej i końcowy układ.
- Podsumowanie CoinPoker jest nadrzędnym źródłem wyniku; Gemini nie może go reinterpretować na podstawie kart.
- Dodać regresyjny przypadek `#96890300082`: `Hero showed [Qh Qd] and won (₮24.67) with Full House` musi dawać `WON`, `heroWinnings: 24.67` i `FULL_HOUSE`.

## 3. Uziemienie i kontrola Gemini

- Wywołanie AI ma otrzymywać cały sparsowany obiekt rozdania, nie tylko `rawText`.
- Na początku promptu umieścić nadrzędne fakty: ID, `WON/LOST/FOLDED`, kwotę zebraną, wynik netto i końcowy układ.
- Polecić modelowi analizowanie decyzji, ale zabronić zmiany ustalonego wyniku.
- Wymusić JSON przez `responseMimeType` i `responseSchema`, dodając obowiązkowe `heroResult` oraz dotychczasowe komentarze. Mechanizm ten jest obsługiwany przez `generateContent` dla Gemini 2.5 według [oficjalnej dokumentacji Google](https://ai.google.dev/gemini-api/docs/migrate-to-interactions).
- Lokalnie sprawdzić, czy `heroResult` dokładnie odpowiada wynikowi parsera. Sprzeczną odpowiedź odrzucić, pokazać błąd i nie zapisywać jej.
- Nie wykonywać automatycznego ponowienia płatnego żądania.
- Thunk zwraca `handId` razem z analizą, aby wynik nie został zapisany pod innym rozdaniem po zmianie zaznaczenia.
- Unieważnić cały dotychczasowy cache analiz przez nową wersję klucza/schema.

## 4. Testy i akceptacja

- Testy parsera dla kategorii układów, wygranej, przegranej, foldu, mucku i wygranej bez showdownu.
- Test przepływu filtr → pasujące sesje → pasujące rozdania → automatyczny wybór.
- Mockowane testy Gemini: poprawny wynik jest zapisywany, sprzeczny odrzucany, a retry nie następuje.
- Test treści promptu dla `#96890300082`, potwierdzający przekazanie `Hero wygrał`.
- Build oraz ESLint zmienionych plików; pełny lint ma obecnie 25 wcześniejszych błędów.
- Bez automatycznych prawdziwych wywołań Gemini; końcowy smoke test wykonuje użytkownik ręcznie na wskazanym rozdaniu.
- Zachować istniejące staged zmiany.
