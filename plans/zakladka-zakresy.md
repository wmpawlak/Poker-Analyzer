# Moduł „Zakresy”: pierwsza komórka AA

## Zadanie 1 — Bezpieczne przygotowanie

1. Sprawdzić `git status` i nie modyfikować istniejących zmian użytkownika w treningach oraz danych pokerowych.
2. Pozostawić moduł całkowicie niezależny od Redux, backendu, importów rozdań i analiz AI.
3. Przyjąć stan domyślny dla nowej komórki: wszystkie pozycje mają wartość `50` (`Call`).

## Zadanie 2 — Dodać zakładkę i widok

1. W `src/components/Sidebar.jsx` dodać przycisk nawigacji:
   - identyfikator: `ranges`;
   - etykieta: `Zakresy`;
   - ikona z obecnego zestawu `lucide-react`.
2. W `src/App.jsx`:
   - dodać etykietę `Zakresy` do nagłówka zakładki;
   - dodać lazy-loaded widok `RangesView`;
   - renderować go wyłącznie, gdy `activeTab === 'ranges'`.
3. Utworzyć `src/views/RangesView.jsx` jako samodzielny widok pierwszej komórki zakresu.

## Zadanie 3 — Zbudować komponent komórki AA

1. W widoku wyświetlić duże, jednoznaczne oznaczenie `AA` nad macierzą.
2. Zbudować kwadratową macierz `2 × 2`, z czterema równymi polami w układzie:
   - górny wiersz: `UTG`, `HJ`;
   - dolny wiersz: `BTN`, `SB`.
3. Każde pole:
   - ma widoczny skrót pozycji wewnątrz;
   - otrzymuje tło zależne wyłącznie od wartości swojej pozycji;
   - przechodzi płynnie przez trzy punkty: `0 = Fold / zielony`, `50 = Call / żółty`, `100 = Raise / czerwony`.
4. Zastosować responsywny rozmiar: macierz pozostaje kwadratowa i nie wychodzi poza dostępny obszar widoku.

## Zadanie 4 — Dodać cztery suwaki agresji

1. Pod macierzą umieścić wspólny panel czterech kontrolek, w kolejności `UTG`, `HJ`, `BTN`, `SB`.
2. Każda kontrolka zawiera:
   - etykietę pozycji;
   - suwak typu `range`, z zakresem `0–100`, krokiem `1` i wartością bieżącą;
   - skalę pod suwakiem: `Fold` po lewej w zieleni, `Call` pośrodku w żółci, `Raise` po prawej w czerwieni;
   - wizualny gradient toru suwaka zgodny z kolorami komórki.
3. Przesunięcie suwaka aktualizuje natychmiast tylko przypisany kwadrat macierzy.
4. Zapewnić dostępność: każdy suwak ma własny tekstowy `label` oraz zrozumiały `aria-label`, np. „Agresja UTG”.

## Zadanie 5 — Zapamiętywanie lokalne

1. Trzymać cztery wartości w lokalnym stanie widoku jako obiekt kluczowany pozycją.
2. Po zmianie wartości zapisywać cały obiekt do `localStorage` pod stabilnym, wersjonowanym kluczem, np. `poker.range-matrix.aa.v1`.
3. Przy pierwszym renderze:
   - odczytać zapis;
   - zaakceptować wyłącznie liczby całkowite `0–100` dla wszystkich czterech pozycji;
   - dla braku, uszkodzonego JSON-a lub niepełnych danych użyć stanu domyślnego `50` dla każdej pozycji.
4. Nie zapisywać tych wartości na serwerze i nie mieszać ich z ustawieniami AI.

## Zadanie 6 — Testy i weryfikacja końcowa

1. Rozszerzyć test nawigacji o przycisk `Zakresy` i przejście do widoku.
2. Dodać test UI widoku zakresów, który potwierdza:
   - obecność oznaczenia `AA`;
   - układ i etykiety `UTG`, `HJ`, `BTN`, `SB`;
   - cztery suwaki oraz skale Fold / Call / Raise.
3. Zasymulować zmianę każdego suwaka i potwierdzić, że zmienia wartość oraz styl tylko właściwego pola.
4. Zweryfikować odtworzenie zapisanych wartości po ponownym montowaniu widoku oraz bezpieczny fallback dla błędnego `localStorage`.
5. Na końcu uruchomić testy dotyczące nawigacji i widoku, a następnie pełne `npm test`, `npm run lint` oraz `npm run build`.
