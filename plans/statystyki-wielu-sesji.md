# Zbiorcza analiza AI wielu sesji Cash i turniejowych

## Podsumowanie

W „Moim profilu” powstanie podwidok „Analiza wielu sesji”. Pozwoli wybierać najnowsze aktualne raporty zarówno sesji Cash, jak i turniejów. Istniejący filtr profilu „Wszystko / Cash / Turnieje” będzie sterował listą dostępnych sesji.

W trybie „Wszystko” raport pokaże wspólny profil stylu oraz osobne sekcje Cash i Turnieje. Wyniki finansowe obu kategorii nigdy nie będą sumowane ani przeliczane we wspólnej jednostce.

## Zadania

1. **Uogólnić kontrakt z turniejów na wszystkie sesje**
   - Dodać wspólny typ źródła `cash` albo `tournament`.
   - Połączyć istniejące sesje Cash i turniejowe w jedną listę kandydatów.
   - Dla każdej sesji udostępniać wyłącznie najnowszy raport zgodny z aktualnym fingerprintem jej pełnych danych.
   - Z wybranych sesji zebrać wszystkie prawdziwe ręce, niezależnie od filtrów widoków Cash i Turnieje; wykluczyć rebuy.
   - Wymagać co najmniej dwóch różnych sesji. W trybie „Wszystko” mogą to być dwie sesje jednej kategorii.
   - Blokować duplikaty, stabilnie sortować źródła i generować fingerprint niezależny od kolejności zaznaczania.
   - Zachować limit 1 500 000 bajtów bez obcinania, dzielenia lub próbkowania danych.

2. **Przygotować metryki dla jednej lub obu kategorii**
   - Dla wszystkich wybranych rąk policzyć wspólne metryki decyzyjne i lokalny profil stylu.
   - Oddzielnie policzyć pełne metryki Cash oraz Turniejów.
   - We wspólnej części przekazywać wyłącznie porównywalne statystyki: Hands, VPIP, PFR, 3-bet, RFI, AF, AFq, c-bet, WTSD, W$SD, profil i wiarygodność.
   - Wynik Cash zachować wyłącznie w walucie i BB/100.
   - Wynik turniejowy zachować wyłącznie w żetonach i żetonach/100.
   - Nie przekazywać wspólnej sumy zysku ani wspólnego winrate dla próbki mieszanej.
   - Do AI wysyłać wybrane raporty, metadane sesji, zagregowane metryki i ID rąk już wskazane w raportach — bez surowych historii rozdań.

3. **Rozszerzyć format raportu AI**
   - Raport główny zawiera lokalnie potwierdzony wspólny styl, wiarygodność, podsumowanie, maksymalnie pięć mocnych stron, maksymalnie pięć powtarzalnych błędów i dokładnie trzy priorytety treningowe.
   - Dodać `categoryInsights` z maksymalnie jedną sekcją Cash i jedną sekcją Turnieje.
   - Sekcja kategorii powstaje tylko wtedy, gdy w wyborze znajduje się przynajmniej jedna sesja danego typu.
   - Każda sekcja kategorii zawiera krótkie podsumowanie, charakterystyczne tendencje i zalecenia odnoszące się wyłącznie do tej kategorii.
   - Każdy wniosek wskazuje raporty źródłowe; opcjonalne ID rąk muszą należeć do wskazanego raportu i aktualnej sesji.
   - Powtarzalny błąd w raporcie głównym musi mieć dowody z co najmniej dwóch różnych sesji.
   - Odrzucać sprzeczny styl, obcy raport, obce rozdanie, powielone źródło, niepasującą kategorię i brak trzech priorytetów.
   - Prompt pozostaje polski, traktuje lokalne dane jako autorytatywne i zabrania oceniania decyzji wyłącznie przez wynik.

4. **Dodać endpoint i transport zbiorczej analizy**
   - Dodać `POST /api/ai/analyze-session-group`.
   - Wejście: `{ modelId, group }`.
   - Sukces: `{ model, fingerprint, analysis }`; błąd: `{ error, code }`.
   - Używać aktualnego modelu domyślnego.
   - OpenAI używa `max_output_tokens: 32000` i `reasoning: high`; konfiguracji Gemini nie zmieniać.
   - Jedno ręczne uruchomienie wykonuje dokładnie jeden potencjalnie płatny POST.
   - Polling OpenAI wykonuje wyłącznie GET-y tej samej odpowiedzi.
   - Nie wprowadzać automatycznego retry, zmiany modelu, dzielenia próbki ani zapisu niepełnego raportu.
   - Bezpieczna telemetria może zawierać tylko Response ID, status, powód i statystyki tokenów.

5. **Dodać stan Redux i wspólną historię**
   - Dodać thunk analizy wielu sesji oraz niezależne stany loading/error.
   - Zapisywać pełną historię w `poker_ai_session_group_analyses_v1`.
   - Każdy wpis przechowuje model, datę, aktywną kategorię profilu, zakres dat, źródłowe raporty, liczbę sesji i rąk, rozbicie Cash/Turnieje, fingerprint oraz wynik.
   - Powtórne uruchomienie dla tego samego wyboru dopisuje nowy raport.
   - Oznaczać raport historyczny jako nieaktualny, gdy zniknie źródłowa sesja, zmieni się jej fingerprint albo wybrany raport przestanie być aktualny.
   - Błąd i niepełna odpowiedź nie mogą modyfikować historii ani localStorage.
   - `clearData` usuwa nowy cache; migracja dotychczasowych cache nie jest potrzebna.

6. **Zbudować podwidok „Analiza wielu sesji”**
   - Dodać przycisk otwierający podwidok z „Mojego profilu” oraz przycisk powrotu.
   - Podwidok korzysta z istniejącego filtra profilu:
     - `Wszystko` pokazuje sesje Cash i Turnieje;
     - `Cash` pokazuje tylko sesje Cash;
     - `Turnieje` pokazuje tylko turnieje.
   - Zmiana globalnej kategorii usuwa zaznaczenia, które przestały być widoczne.
   - Zachować osobny, włącznie liczony zakres dat według daty rozpoczęcia sesji.
   - Zakres dat tylko filtruje listę; wybór odbywa się ręcznie checkboxami.
   - Zmiana dat usuwa ukryte zaznaczenia.
   - Dodać „Zaznacz widoczne”, „Wyczyść wybór” oraz liczniki wszystkich, Cash i Turniejów.
   - Wiersz Cash pokazuje stół, datę, liczbę rąk, model i datę raportu.
   - Wiersz turniejowy pokazuje nazwę i ID turnieju, datę, liczbę rąk, model i datę raportu.
   - Przycisk generowania jest nieaktywny przy mniej niż dwóch sesjach, błędnym zakresie albo nieskonfigurowanym modelu.
   - Przed wywołaniem AI wyświetlić wspólny lokalny profil oraz osobne podsumowania wyników Cash i Turniejów.
   - Po sukcesie pokazać raport główny, sekcje właściwych kategorii i trzy priorytety.
   - Źródła prowadzą do sesji oraz istniejących rąk w Replayerze; niedostępne historyczne ręce mają nieaktywny przycisk.
   - Dodać wybór raportu z pełnej historii i oznaczenie nieaktualnych wyników.
   - Dla `AI_INCOMPLETE_RESPONSE` pokazać „Spróbuj ponownie — nowe płatne żądanie”; pozostałe błędy zachowują zwykłe ponowienie.
   - Uzupełnić README o zakres Cash/Turnieje, osobne jednostki wyników, koszt ręcznego uruchomienia i historię.

7. **Dodać testy i wykonać pełną weryfikację — wyłącznie na końcu**
   - Kontrakt: sesje Cash i turniejowe, filtr kategorii, daty włączne, minimum dwóch źródeł, stabilny fingerprint, brak duplikatów, rebuy poza metrykami i limit rozmiaru.
   - Metryki: wspólny styl z pełnej próbki, osobne wyniki Cash i Turniejów oraz brak wspólnej sumy lub winrate.
   - Walidacja AI: zgodny styl, poprawne źródła i ręce, właściwe sekcje kategorii, co najmniej dwie sesje dla powtarzalnego błędu oraz dokładnie trzy priorytety.
   - Adapter/API: profil `32000 + high`, jeden POST, polling GET, propagacja kodów błędów i niezmieniona konfiguracja Gemini.
   - Redux/cache: pełna historia, brak zapisu po błędzie, wykrywanie nieaktualności i czyszczenie danych.
   - UI: podwidok, globalny filtr profilu, zakres dat, usuwanie ukrytych zaznaczeń, sesje obu typów, blokady przycisku, rozbicie raportu, historia i Replayer.
   - Uruchomić `npm test`, lint wszystkich zmienionych plików, `npm run build` oraz `git diff --check`.
   - Nie wykonywać prawdziwego ani płatnego wywołania modelu bez osobnej decyzji użytkownika.

## Założenia

- Filtr kategorii podwidoku jest tym samym filtrem, który już działa w nagłówku „Mojego profilu”.
- Lista początkowo nie ma zaznaczeń.
- Nie ma sztywnego limitu liczby sesji poza limitem rozmiaru wejścia.
- Tryb „Wszystko” wymaga dwóch dowolnych sesji, bez obowiązku wybierania obu kategorii.
- Wspólny styl jest autorytatywnie liczony lokalnie, ale wyniki ekonomiczne pozostają rozdzielone.
- Wszystkie istniejące niezacommitowane zmiany muszą zostać zachowane.
