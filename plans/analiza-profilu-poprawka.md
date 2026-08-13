# Naprawa okresowej analizy AI profilu Hero

## Diagnoza

- Błąd występuje po opłaconym żądaniu, gdy odpowiedź zawiera pusty, powielony lub nieistniejący `metricId`. Obecny schemat dopuszcza dowolny tekst zamiast wyłącznie identyfikatorów z katalogu, a walidator odrzuca potem cały raport.
- Dokładnego błędnego ID nie da się odzyskać: odrzucona odpowiedź nie jest zapisywana ani diagnostycznie logowana.
- Dataset jest prawidłowy. Cała historia zawiera 19 340 rąk i 37 raportów sesyjnych; 35/35 testów analizy profilu przechodzi. Problem jest zależny od odpowiedzi modelu.
- Raporty są już przekazywane do analizy, ale cztery ponowne analizy sesji są liczone jako osobne źródła. Może to nadmiernie wzmacniać wnioski z jednej sesji.

## Małe zadania implementacyjne

1. **Wybór raportów sesyjnych**
   - Dla każdej sesji wybrać najnowszy raport, którego fingerprint nadal odpowiada sesji i który przechodzi walidację.
   - Zachować tylko sesje w całości mieszczące się w wybranym okresie, aby raport nie wnosił rozdań spoza zakresu.
   - `availableReports` ma oznaczać liczbę sesji posiadających aktualny raport, a nie liczbę historycznych wersji raportów.

2. **Reprezentacja Cash i Turniejów**
   - Dla filtra Cash albo Turnieje używać maksymalnie 20 raportów danego typu, równomiernie rozłożonych w czasie.
   - Dla „Wszystko” przydzielić początkowo po 10 miejsc na Cash i Turnieje; niewykorzystany limit przekazać drugiej kategorii.
   - Zachować statystyki wspólne, ale wynik i winrate oraz `categoryInsights` utrzymywać osobno dla Cash i Turniejów.

3. **Ściślejszy schemat odpowiedzi**
   - Generować schemat na podstawie bieżącego `metricCatalog` i dostępnych `reportId`.
   - Ograniczyć elementy `metricIds` i `sessionReportIds` przez `enum`, a tablice przez `minItems`/`maxItems`.
   - Użyć `$defs`, aby nie powielać dużych fragmentów schematu. Te elementy są obsługiwane przez [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas) i [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).
   - Nie używać `uniqueItems`; duplikaty obsłuży deterministyczna normalizacja serwera.

4. **Normalizacja płatnej odpowiedzi**
   - Przed końcową walidacją przyciąć referencje do pięciu, usunąć puste wartości, duplikaty, obce ID i referencje niewłaściwej kategorii.
   - Zachować kolejność poprawnych referencji.
   - Jeżeli po oczyszczeniu wniosek nie ma poprawnej metryki, pozostawić pustą listę i ostrzeżenie — nie wymyślać zastępczej metryki.
   - Tak samo oczyszczać opcjonalne `sessionReportIds`.
   - Nadal odrzucać odpowiedzi z niekompletną strukturą, pustą treścią, niezgodnym stylem/wiarygodnością, błędnymi kategoriami lub inną niż trzy liczbą priorytetów.
   - Nie wykonywać automatycznego retry ani zmiany modelu.

5. **Diagnostyka referencji**
   - Zwracać i zapisywać `referenceWarnings` w formie `{ path, kind, reason, discardedIds }`.
   - Obsłużyć powody: `missing`, `unknown`, `duplicate`, `wrongCategory` i `limit`.
   - Starsze zapisane raporty bez tego pola normalizować do `referenceWarnings: []`, bez przepisywania cache.

6. **Prompt analizy okresowej**
   - Wyraźnie wymienić dozwolone identyfikatory i zabronić powtarzania ich w obrębie jednego wniosku.
   - Nakazać syntezę lokalnych statystyk z powtarzalnymi wzorcami znalezionymi w skrótach raportów sesji.
   - Zachować obecny format: podsumowanie, osobne wnioski Cash/Turnieje, mocne strony, leaki z korektami i trzy priorytety treningowe.

7. **API, Redux i historia**
   - `POST /api/ai/analyze-player` rozszerzyć o `referenceWarnings`; nadal ma wykonywać dokładnie jedno wywołanie dostawcy.
   - Zapisać oczyszczoną analizę, ostrzeżenia, snapshot statystyk i wykorzystane najnowsze raporty sesji.
   - Preview ma pokazywać pokrycie osobno dla Cash i Turniejów.
   - W raporcie wyświetlić zbiorczy komunikat o oczyszczonych referencjach oraz małe ostrzeżenie przy sekcji, która utraciła wszystkie źródła.

8. **Dokumentacja zachowania**
   - Opisać, że filtr typu gry jest respektowany, a „Wszystko” analizuje oba typy.
   - Wyjaśnić, że używany jest jeden najnowszy raport na sesję, maksymalnie 20 źródeł, bez dodatkowych płatnych żądań.
   - Zaktualizować znaczenie liczników pokrycia raportami.

## Zmiany interfejsów

- Odpowiedź analizy i zapisany raport otrzymają `referenceWarnings: Array<{ path, kind, reason, discardedIds }>`.
- `analysis.*MetricIds` i `analysis.*SessionReportIds` pozostają tablicami, dzięki czemu stare raporty i obecny renderer zachowują kompatybilność.
- `sessionEvidence.coverage` zachowuje dotychczasowy kształt, lecz `availableReports` liczy najnowsze raporty unikalnych sesji.
- Nie zmienia się payload żądania ani sposób filtrowania dat i typu gry.

## Testy i kryteria akceptacji

- Testy buildera: jeden najnowszy raport na sesję, pomijanie nieaktualnych raportów, równy przydział Cash/Turnieje, redystrybucja wolnych miejsc i limit 20.
- Testy kontraktu: dynamiczne enumy, poprawne referencje bez ostrzeżeń oraz oczyszczanie pustych, obcych, powielonych i międzykategoriowych ID.
- Test API: wadliwe referencje dają zapisany raport z ostrzeżeniami, dokładnie jedno wywołanie modelu i brak retry; błędna struktura nadal daje `422`.
- Test Redux/UI: zapis ostrzeżeń, kompatybilność starego cache, podział pokrycia Cash/Turnieje i komunikaty przy brakujących źródłach.
- Końcowo uruchomić celowane testy analizy profilu, pełne `npm test`, lint, build oraz `git diff --check`; bez prawdziwych płatnych wywołań AI.

## Założenia

- Filtr profilu steruje analizą; tylko „Wszystko” łączy Cash i Turnieje.
- Treść poprawnej strukturalnie odpowiedzi zostaje zachowana mimo wadliwych referencji, ale brak źródła jest jawnie oznaczony.
- Nie podejmujemy próby odtworzenia konkretnej odrzuconej odpowiedzi, ponieważ nie została zapisana.
- Zmiana nie usuwa ani nie modyfikuje trzech istniejących raportów historycznych.
