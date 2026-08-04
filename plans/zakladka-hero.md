# Układy bez showdownu i profil okresowy — zadania

Testów, ESLint i builda nie uruchamiamy po każdym zadaniu. Są tylko dwa punkty walidacji: po zadaniu 3 oraz po zadaniu 6.

## Zadanie 1 — Rozpoznać wariant rozdania

W `pokerParser.js` dodać `gameVariant`:

- `NLH`
- `NLH BombPot`
- `PLO 4`

`SUMMARY` nadal jest źródłem prawdy dla wyniku rozdania.

## Zadanie 2 — Dodać ewaluator układu z widocznych kart

Dodać czystą funkcję dla NLH/NLH BombPot.

- Preflop: pocket pair → `PAIR`; pozostałe ręce → `HIGH_CARD`.
- Postflop: najlepszy układ z kart Hero i odsłoniętego boardu.
- Nie przewidywać kart, które nie pojawiły się w logu.
- PLO 4 nie przechodzi przez ewaluator holdemowy.

## Zadanie 3 — Połączyć ewaluator z parserem

Ustalić kolejność:

1. Rozpoznany układ z `SUMMARY` ma pierwszeństwo.
2. Bez układu w `SUMMARY`, dla NLH/NLH BombPot wyliczyć układ z widocznych kart.
3. Dla PLO 4 pozostawić `NO_HAND`.

Dodać `handRankingSource`: `SUMMARY`, `VISIBLE_CARDS`, `UNSUPPORTED_VARIANT`, `UNAVAILABLE`.

Dodać tooltip w kafelku ręki i replayerze dla układu wyliczonego lokalnie.

### Walidacja po zadaniu 3

- Testy ewaluatora: preflop, wszystkie kategorie NLH, najlepszy układ z 5–7 kart.
- Test pierwszeństwa `SUMMARY`.
- Test PLO 4 bez holdemowej klasyfikacji.
- Regresja filtrów układów.
- ESLint plików parsera i testów.

## Zadanie 4 — Dodać filtr okresu profilu

Dodać czystą logikę filtrowania rąk według daty.

- „Od” od początku dnia; „do” do końca dnia.
- Obie granice włączne.
- Pusty zakres = cała historia.
- `od > do` = komunikat walidacyjny i brak raportu.
- Rebuy pozostaje wykluczony.

## Zadanie 5 — Przygotować dane raportu profilu

Rozszerzyć logikę metryk profilu.

- Cash lub Turnieje: użyć obecnego agregatora sesji.
- „Wszystko”: wspólne statystyki i styl ze wszystkich rąk.
- „Wszystko”: osobny wynik netto i winrate dla Cash oraz Turniejów.
- Nie sumować BB/100 z żetonami/100.

## Zadanie 6 — Zastąpić widok „Mój profil”

Usunąć stare sześć kart i zbudować raport okresowy.

- Pola dat „od” i „do” z natywnym kalendarzem oraz ręcznym wpisywaniem.
- Początkowo: cała wczytana historia.
- Przycisk „Wyczyść zakres”.
- Pełny zestaw kafelków statystyk, tooltipów i stylu gry jak w podsumowaniu sesji.
- Przełącznik Cash / Turnieje / Wszystko nadal steruje profilem.
- W „Wszystko” wynik Cash i Turniejów jest pokazany osobno.

### Walidacja po zadaniu 6

- Test dat: granice włączne, pusty zakres i odwrócony zakres.
- Test raportu mieszanego: wspólne statystyki oraz osobne wyniki Cash/Turniejów.
- Test renderowania nowego widoku profilu.
- Pełne `npm test`, ESLint zmienionych plików i `npm run build`.

## Założenia

- NLH BombPot używa reguł NLH.
- PLO 4 pozostaje nieobsługiwane w tym zakresie i zachowuje `NO_HAND`.
- Pełna obsługa PLO będzie osobnym zadaniem.
