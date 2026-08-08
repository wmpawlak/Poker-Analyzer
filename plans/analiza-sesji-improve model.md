# Naprawa niepełnej analizy sesji OpenAI

## Podsumowanie

Obecny limit `8000` jest wspólny dla pojedynczego rozdania i całej sesji, mimo zupełnie innej złożoności wejścia. Naprawa wprowadzi osobny profil sesji: `max_output_tokens: 32000` i `reasoning: high`. Analiza rozdania pozostanie przy `8000 + high`.

Zachowujemy dokładnie jeden płatny POST na uruchomienie, bez automatycznego ponawiania, dzielenia sesji, obcinania danych ani zapisywania częściowego raportu.

## Zadania

1. **Rozdzielić profile generowania OpenAI**
   - Sparametryzować adapter przez `maxOutputTokens` i `reasoningEffort`, z dotychczasowymi wartościami jako domyślnymi.
   - Dla analizy sesji przekazywać jawnie `32000 + high`.
   - Nie zmieniać konfiguracji Gemini ani analiz pojedynczych rozdań.
   - Nie wprowadzać heurystycznych limitów zależnych od liczby rąk — bez danych o zużyciu byłaby to pozorna precyzja.

2. **Usprawnić obsługę przekroczenia limitu i kosztu ponowienia**
   - Zachować kod `AI_INCOMPLETE_RESPONSE`, ale zwracać go również w odpowiedzi `/api/ai/analyze-session` obok dotychczasowego pola `error`.
   - Zamienić techniczne `max_output_tokens` na komunikat mówiący, że OpenAI wykorzystał cały budżet i raport nie został zapisany.
   - Dla tego błędu wyświetlać przycisk: „Spróbuj ponownie — nowe płatne żądanie”, bez dodatkowego potwierdzenia.
   - Inne błędy zachowują zwykłe ponowienie, aby nie sugerować kosztu tam, gdzie żądanie zostało odrzucone przed dostawcą.
   - Zachować dokładnie jeden POST; polling nadal wykonuje wyłącznie GET-y tej samej odpowiedzi.
   - Rejestrować lokalnie Response ID, powód i dostępne statystyki tokenów, bez logowania promptu, klucza ani historii rąk.

3. **Zaktualizować dokumentację**
   - Opisać różne profile dla rozdania i sesji oraz fakt, że `32000` jest maksymalnym budżetem, a nie kosztem naliczanym z góry.
   - Wyjaśnić, że ręczne ponowienie tworzy nowe potencjalnie płatne żądanie.
   - Zachować udokumentowane gwarancje: brak automatycznego retry, brak częściowego raportu i brak cichego próbkowania sesji.

4. **Testy i weryfikacja — wyłącznie na końcu**
   - Adapter: rozdanie nadal wysyła `8000 + high`, sesja wysyła `32000 + high`.
   - Transport: `incomplete/max_output_tokens` nie uruchamia drugiego POST-a i zwraca właściwy kod błędu.
   - API/Redux: kod błędu dociera do panelu, a niepełna analiza nie trafia do historii ani cache.
   - UI: właściwa etykieta płatnego ponowienia pojawia się tylko dla przekroczenia limitu.
   - Uruchomić dopiero po zakończeniu zadań 1–3: `npm test`, lint zmienionych plików, `npm run build` i `git diff --check`.
   - Nie wykonywać automatycznego ani ręcznego wywołania prawdziwego modelu; ewentualny płatny smoke test wymaga osobnej świadomej decyzji.

## Interfejsy i założenia

- Wewnętrzny interfejs adaptera OpenAI otrzyma opcjonalne `maxOutputTokens` i `reasoningEffort`.
- Błędy API zostaną wstecznie kompatybilnie rozszerzone z `{ error }` do `{ error, code }`; wejście endpointu i format udanego raportu się nie zmienią.
- Nie będzie migracji cache ani zmiany schematu raportu sesji.
- Zakładamy obsługę limitu `32000` przez skonfigurowane modele Terra i Sol; nie będziemy tego weryfikować płatnym żądaniem.
- Implementacja ma zachować wszystkie istniejące, niezacommitowane zmiany w repozytorium.
