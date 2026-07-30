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

## Kontrole

```powershell
npm test
npm run lint
npm run build
```

Testy adapterów i API używają mocków i nie wykonują płatnych wywołań. Ręczny smoke test prawdziwego modelu należy wykonać świadomie z poziomu Replayera.
