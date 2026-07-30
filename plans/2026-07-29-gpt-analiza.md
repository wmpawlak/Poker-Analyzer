# Trener AI: Gemini i GPT przez backend

## Zadanie 1: Konfiguracja i sekrety

- Wczytywać `.env.local` przez Node.
- Obsłużyć `GEMINI_API_KEY` i `OPENAI_API_KEY`.
- Dodać `.env.example` bez prawdziwych kluczy.
- Nie nadpisywać istniejącego `.env.local`.
- Usunąć klucz Gemini ze stanu Redux i wyczyścić `poker_gemini_key` z localStorage.
- Nie kopiować wcześniej ujawnionego klucza — wymaga obrócenia.

Kryterium ukończenia: żaden klucz nie trafia do kodu frontendu, odpowiedzi API ani konsoli.

## Zadanie 2: Wspólny kontrakt analizy

- Wydzielić prompt, JSON Schema i walidację poza Redux.
- Zachować pola: `heroResult.outcome`, `preflop`, `flop`, `turn`, `river`, `summary`.
- CoinPoker `SUMMARY` pozostaje źródłem ID, wyniku, kwot i układu.
- Odrzucać odpowiedź tylko przy niezgodnym `outcome`.
- Po akceptacji dołączać lokalne `handId`, `heroWinnings`, `netProfit` i `handRanking`.
- Komunikaty walidacji uczynić niezależnymi od dostawcy.

Kryterium ukończenia: Gemini i GPT zwracają identyczny raport aplikacyjny.

## Zadanie 3: Adaptery dostawców

- Zachować adapter Gemini 2.5 Flash.
- Dodać adaptery GPT‑5.6 Terra i GPT‑5.6 Sol przez Responses API.
- Dla GPT ustawić:
  - Structured Outputs z `strict: true`,
  - reasoning `high`,
  - `store: false`,
  - brak narzędzi i wyszukiwania,
  - limit 8000 tokenów wyjściowych.
- Obsłużyć odmowę, niepełną odpowiedź, błędny JSON i błędy HTTP.
- Nie wykonywać automatycznego retry.

Kryterium ukończenia: każdy adapter wykonuje najwyżej jedno płatne żądanie i zwraca wspólny format.

## Zadanie 4: Backendowe API analizy

- Dodać `GET /api/ai/models`.
- Zwracać modele:
  - `gemini-2.5-flash`,
  - `gpt-5.6-terra`,
  - `gpt-5.6-sol`.
- Dla każdego zwracać `id`, nazwę i `configured`, nigdy klucz.
- Dodać `POST /api/ai/analyze` przyjmujący `modelId` i sparsowane rozdanie.
- Zwracać `{ model, analysis }`.
- Zwracać `400` dla nieznanego modelu i `503` dla brakującego klucza.

Kryterium ukończenia: frontend nie komunikuje się bezpośrednio z Google ani OpenAI.

## Zadanie 5: Redux i cache

- Zastąpić `apiKey` ustawieniem `defaultAiModel`.
- Zapisywać wybór jako `poker_ai_default_model`.
- Ustawić początkowo `gpt-5.6-terra`.
- Thunk analizy ma wywoływać wyłącznie lokalne `/api/ai/analyze`.
- Zapisywać tylko ostatnią analizę danego rozdania wraz z modelem i datą.
- Podnieść cache do v3.
- Przenieść raporty v2 jako analizy Gemini.

Kryterium ukończenia: nowy raport nadpisuje poprzedni niezależnie od modelu.

## Zadanie 6: Ustawienia i Replayer

- Usunąć pole klucza i przycisk testowania połączenia.
- Pokazać wybór domyślnego modelu oraz status konfiguracji.
- Uniemożliwić użycie modelu bez odpowiedniego klucza.
- Nie przełączać automatycznie na innego dostawcę.
- W Replayerze pokazywać nazwę modelu ostatniego raportu.
- „Przeanalizuj ponownie” używa aktualnego modelu domyślnego.

Kryterium ukończenia: ustawienia przechowują wyłącznie wybór modelu.

## Zadanie 7: Testy i dokumentacja

- Mockowane testy wszystkich trzech adapterów bez prawdziwych wywołań.
- Testy zgodnego i sprzecznego `outcome`.
- Regresja rozdania `#96890300082`.
- Testy API dla brakującego klucza, nieznanego modelu, odmowy i błędu dostawcy.
- Potwierdzić brak automatycznego retry.
- Przetestować wybór modelu, migrację cache i nadpisywanie raportu.
- Opisać konfigurację `.env.local` i obrót klucza Gemini.
- Uruchomić testy, ESLint zmienionych plików i build.

Kryterium ukończenia: wszystkie kontrole przechodzą bez płatnych żądań; ręczny smoke test pozostaje po stronie użytkownika.

## Założenia

- Perplexity nie wchodzi do tego etapu.
- AI wymaga uruchomienia aplikacji przez lokalny serwer Express.
- Nieskonfigurowany model pozostaje widoczny, ale niedostępny.
