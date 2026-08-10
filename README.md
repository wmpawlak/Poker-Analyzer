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

## Dane pokerowe i import

Kanoniczne rozdania są zapisane w `data/poker/hands/*.jsonl`; oryginalne pliki TXT i raporty importu trafiają odpowiednio do `data/poker/sources/`, `data/poker/imports/` oraz `data/poker/issues/`. Przeglądarka pobiera wyłącznie agregaty, strony list i pojedyncze rozdanie potrzebne Replayerowi — nigdy pełne TXT ani JSONL.

Istniejące pliki TXT można jednorazowo przenieść do nowego magazynu świadomie:

```powershell
npm run data:migrate -- --dry-run
npm run data:migrate -- --apply
```

Najpierw zawsze sprawdź wynik `--dry-run`. Tryb `--apply` jest idempotentny: dodaje wyłącznie nowe ID rozdań, pomija identyczne duplikaty i nie nadpisuje konfliktów. Konflikt (to samo `handId`, inna treść) oraz nieprawidłowa sekcja są opisane w raporcie `issues/<importId>.json`; poprawne ręce z tego samego pliku są nadal importowane. Konfliktową rękę można zastąpić tylko świadomie przez CLI `data:replace-hand` z najpierw `--dry-run`, a potem `--apply`.

Zakładka „Wgrane pliki” jest centrum importu: przyjmuje jeden plik TXT albo uruchamia ręczne skanowanie `data/inbox/`. Pliki `data/inbox/*.txt` są celowo ignorowane przez Git i po poprawnym imporcie są archiwizowane. Nie ma włączania, wyłączania ani kasowania źródeł z interfejsu.

Indeks w `data/.cache/` jest pochodny i ignorowany przez Git. Po zmianie kanonicznych danych aplikacja odtworzy go automatycznie; gdy trzeba wymusić odbudowę, zatrzymaj serwer i usuń wyłącznie `data/.cache/poker-index-v1.json.gz`. Nie usuwaj katalogu `data/poker/` ani archiwów źródeł.

Po sprawdzeniu raportu importu wykonaj ręcznie workflow Git:

```powershell
git status
git add data/poker data/poker-ai-analyses-v1.json
git commit -m "Zapisz import historii pokerowych"
git push
```

Aplikacja nigdy nie wykonuje `commit`, `pull` ani `push` samodzielnie.

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

Raporty AI są przechowywane w dwóch warstwach. Przeglądarka zachowuje lokalną kopię zapasową, a backend synchronizuje wszystkie raporty do wersjonowanego pliku `data/poker-ai-analyses-v1.json`. Plik nie zawiera surowych historii rozdań, kluczy API ani sekretów.

Przy uruchomieniu aplikacja scala raporty z `localStorage` i `data`, więc istniejące analizy są migrowane bez ponownego wywołania dostawcy AI. Nowe raporty oraz cleanup raportów scalonych sesji aktualizują plik w `data` automatycznie. Błąd synchronizacji nie usuwa lokalnej kopii i jest pokazywany w interfejsie.

Plik cache jest zwykłym plikiem repozytorium. Po zakończeniu pracy należy dołączyć go do standardowego commita razem z historiami:

```powershell
git add data/poker data/poker-ai-analyses-v1.json
git commit -m "Zapisz historie i raporty AI"
git push
```

Aplikacja nie wykonuje automatycznie `git commit` ani `git push`. Jeśli dwie maszyny zmienią ten sam plik, konflikt rozwiązuje się jak zwykły konflikt Git; po rozwiązaniu uruchom aplikację i pozwól jej wykonać synchronizację cache.

Przeglądarka zapisuje domyślny identyfikator modelu, historię raportów oraz ID zapisanych rąk. Nowa analiza jest dopisywana do historii danego rozdania. Cache v2 i v3 jest jednorazowo migrowany do v4; raporty z v2 są oznaczane jako wygenerowane przez Gemini 2.5 Flash.

CoinPoker `SUMMARY` pozostaje źródłem prawdy dla ID rozdania, wyniku Hero, kwot i końcowego układu. Odpowiedź modelu jest odrzucana tylko wtedy, gdy błędnie podaje `WON`, `LOST` albo `FOLDED`.

### Analiza całej sesji

W widoku Cash i Turnieje panel „Analiza AI sesji” tworzy ręcznie uruchamiany raport dla całej aktualnie wybranej sesji. Zawsze obejmuje wszystkie prawdziwe rozdania sesji — filtr układów ani sortowanie listy go nie zawężają. Raport używa aktualnego modelu domyślnego, jest dopisywany do niezależnej historii `poker_ai_session_analyses_v1`, a poprzednie raporty pozostają dostępne i są oznaczane, jeżeli dotyczą wcześniejszego zestawu danych.

Profile OpenAI są zależne od zakresu analizy: pojedyncze rozdanie używa `max_output_tokens: 8000` i `reasoning: high`, a cała sesja `max_output_tokens: 32000` i `reasoning: high`. Wartość `32000` jest maksymalnym budżetem generowania jednej odpowiedzi, a nie kosztem naliczanym z góry.

Każde uruchomienie wykonuje najwyżej jeden potencjalnie płatny POST: aplikacja nie podejmuje automatycznych prób ponowienia, nie zmienia automatycznie modelu i nie zapisuje częściowego raportu. Gdy raport nie powstanie z powodu wyczerpania budżetu, ręczne „Spróbuj ponownie — nowe płatne żądanie” tworzy osobne, potencjalnie płatne żądanie. Długie analizy OpenAI działają w trybie background, dlatego po jednym POST-cie serwer odpytuje przez GET status tej samej odpowiedzi przez maksymalnie 15 minut. Tryb background wymaga zapisania odpowiedzi po stronie OpenAI na czas jej przetwarzania. Sesje poniżej 30 rozdań mogą być analizowane, ale panel wyraźnie ostrzega o ograniczonej wiarygodności. Wejście większe niż 1 500 000 bajtów jest odrzucane w całości — nigdy nie jest po cichu skracane ani próbkowane.

### Analiza wielu sesji

„Analiza wielu sesji” jest osobną zakładką sidebara o identyfikatorze `session-group-analysis`, niezależną od „Mojego profilu”. Desktopowy workspace ma lewą kolumnę filtrów, przewijanej listy sesji i stałej akcji oraz prawy panel podglądu, historii i raportu; na węższym ekranie kolumny układają się pionowo, a lista ma ograniczoną wysokość. Lista pokazuje wszystkie sesje z prawdziwymi rozdaniami w bieżących filtrach. Do wspólnej analizy można zaznaczyć wyłącznie sesje z aktualnym raportem zgodnym z odciskiem danych; dla brakującego lub nieaktualnego raportu można bezpośrednio uruchomić analizę z wiersza. Kilka analiz pojedynczych sesji może działać równolegle, a wybór do raportu grupowego nadal wymaga co najmniej dwóch różnych sesji.

Typ gry, zakres dat, zaznaczone `sourceIds` i wybrany raport są przechowywane w `App`, więc przejście do sesji źródłowej albo innej zakładki nie traci pracy. Stan nie jest zapisywany po odświeżeniu strony. Zmiana filtrów lub danych usuwa wyłącznie niewidoczne identyfikatory, a usunięty raport historyczny czyści aktywny wybór.

Przed uruchomieniem raportu aplikacja liczy lokalny wspólny profil stylu oraz osobne wyniki Cash i Turniejów. W próbce mieszanej nie tworzy wspólnej sumy pieniężnej ani wspólnego winrate: Cash pozostaje w walucie i BB/100, a Turnieje w żetonach i żetonach/100. Do modelu trafiają tylko aktualne raporty źródłowe, metadane sesji, lokalne metryki oraz identyfikatory rąk już cytowane przez raporty — nigdy surowe historie rozdań.

Historia grupowych raportów jest zapisywana osobno jako `poker_ai_session_group_analyses_v1` i pozostaje dostępna w nagłówku prawego panelu. Każdy wpis przechowuje model, czas, kategorię, zakres dat, źródła, liczbę sesji i rąk, rozbicie Cash/Turnieje, odcisk oraz raport. Po udanej analizie nowy raport jest automatycznie wybierany. Historyczny wynik jest oznaczany jako nieaktualny, gdy bieżący wybór ma inny odcisk, źródłowa sesja lub jej aktualny raport się zmieni albo zniknie. Linki z wniosków prowadzą do dostępnych sesji i Replayera; niedostępne źródła i rozdania pozostają nieaktywne. Błąd i niepełna odpowiedź nie zmieniają historii. Ręczne uruchomienie wykonuje najwyżej jeden potencjalnie płatny POST; OpenAI używa `max_output_tokens: 32000` oraz `reasoning: high`, a ponowienie po niepełnej odpowiedzi jest wyraźnie opisane jako nowe potencjalnie płatne żądanie.

## Kontrole

```powershell
npm test
npm run lint
npm run build
npm run perf:data
```

Testy adapterów i API używają mocków i nie wykonują płatnych wywołań. Ręczny smoke test prawdziwego modelu należy wykonać świadomie z poziomu Replayera lub panelu sesji.
