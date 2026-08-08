# Poker Analyzer

Lokalna aplikacja do przeglądania historii rozdań CoinPoker i generowania raportów trenera AI przez Gemini albo GPT. Klucze dostawców pozostają po stronie lokalnego serwera Express.

## Uruchomienie

Wymagany jest Node.js 20 lub nowszy.

```powershell
npm install
npm run dev
```

Aplikacja będzie dostępna pod adresem `http://localhost:5173`. Należy uruchamiać ją przez `npm run dev`, ponieważ frontend korzysta z lokalnych endpointów Express.

W trybie produkcyjnym:

```powershell
npm run build
npm start
```

## Konfiguracja AI

Utwórz albo uzupełnij ignorowany przez Git plik `.env.local` w katalogu projektu:

```dotenv
GEMINI_API_KEY=klucz_gemini
OPENAI_API_KEY=klucz_openai
```

Pusty wzór znajduje się w `.env.example`. Zmienne nie mogą mieć prefiksu `VITE_`, ponieważ nie powinny trafić do kodu przeglądarki. Po zmianie kluczy uruchom ponownie serwer.

Dostępne modele:

- Gemini 2.5 Flash — wymaga `GEMINI_API_KEY`;
- GPT-5.6 Terra — wymaga `OPENAI_API_KEY` i jest modelem domyślnym;
- GPT-5.6 Sol — wymaga `OPENAI_API_KEY`.

Ustawienia aplikacji pokazują status konfiguracji każdego modelu. Nieskonfigurowany model pozostaje widoczny, ale nie można wysłać nim analizy. Aplikacja nie przełącza automatycznie dostawcy.

## Bezpieczeństwo i obrót klucza Gemini

Klucz Gemini, który wcześniej pojawił się w adresie żądania lub konsoli, należy uznać za ujawniony:

1. unieważnij stary klucz w panelu dostawcy;
2. utwórz nowy klucz;
3. wpisz go wyłącznie jako `GEMINI_API_KEY` w `.env.local`;
4. uruchom ponownie lokalny serwer.

Nie zapisuj prawdziwych kluczy w `.env.example`, kodzie, localStorage ani zrzutach konsoli. Backend przekazuje klucze tylko w nagłówkach żądań do dostawców i nie zwraca ich frontendowi.

## Analizy i cache

Przeglądarka zapisuje domyślny identyfikator modelu, historię raportów oraz ID zapisanych rąk. Nowa analiza jest dopisywana do historii danego rozdania. Cache v2 i v3 jest jednorazowo migrowany do v4; raporty z v2 są oznaczane jako wygenerowane przez Gemini 2.5 Flash.

CoinPoker `SUMMARY` pozostaje źródłem prawdy dla ID rozdania, wyniku Hero, kwot i końcowego układu. Odpowiedź modelu jest odrzucana tylko wtedy, gdy błędnie podaje `WON`, `LOST` albo `FOLDED`.

### Analiza całej sesji

W widoku Cash i Turnieje panel „Analiza AI sesji” tworzy ręcznie uruchamiany raport dla całej aktualnie wybranej sesji. Zawsze obejmuje wszystkie prawdziwe rozdania sesji — filtr układów ani sortowanie listy go nie zawężają. Raport używa aktualnego modelu domyślnego, jest dopisywany do niezależnej historii `poker_ai_session_analyses_v1`, a poprzednie raporty pozostają dostępne i są oznaczane, jeżeli dotyczą wcześniejszego zestawu danych.

Profile OpenAI są zależne od zakresu analizy: pojedyncze rozdanie używa `max_output_tokens: 8000` i `reasoning: high`, a cała sesja `max_output_tokens: 32000` i `reasoning: high`. Wartość `32000` jest maksymalnym budżetem generowania jednej odpowiedzi, a nie kosztem naliczanym z góry.

Każde uruchomienie wykonuje najwyżej jeden potencjalnie płatny POST: aplikacja nie podejmuje automatycznych prób ponowienia, nie zmienia automatycznie modelu i nie zapisuje częściowego raportu. Gdy raport nie powstanie z powodu wyczerpania budżetu, ręczne „Spróbuj ponownie — nowe płatne żądanie” tworzy osobne, potencjalnie płatne żądanie. Długie analizy OpenAI działają w trybie background, dlatego po jednym POST-cie serwer odpytuje przez GET status tej samej odpowiedzi przez maksymalnie 15 minut. Tryb background wymaga zapisania odpowiedzi po stronie OpenAI na czas jej przetwarzania. Sesje poniżej 30 rozdań mogą być analizowane, ale panel wyraźnie ostrzega o ograniczonej wiarygodności. Wejście większe niż 1 500 000 bajtów jest odrzucane w całości — nigdy nie jest po cichu skracane ani próbkowane.

## Kontrole

```powershell
npm test
npm run lint
npm run build
```

Testy adapterów i API używają mocków i nie wykonują płatnych wywołań. Ręczny smoke test prawdziwego modelu należy wykonać świadomie z poziomu Replayera lub panelu sesji.
