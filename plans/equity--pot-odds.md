# Equity i pot odds z pełną zgodnością starych ćwiczeń

## Podsumowanie

Equity oznacza oczekiwany udział Hero w puli:

`equity = P(wygranej) + ½ × P(remisu)` w heads-up.

Dla terminalnego calla:

`wymagane equity = call / (pula przed callem + call)`

Najważniejsza zasada kompatybilności: obecne spoty, klucze odpowiedzi, sesje i wyniki nadal działają bez zmian. Brak nowej analizy equity:

- nie obniża gotowości istniejącego zadania;
- nie usuwa go ze zwykłych ćwiczeń;
- nie blokuje odpowiedzi ani wznowienia sesji;
- wyklucza je tylko z nowego trybu „Equity i pot odds”;
- w odpowiednim zwykłym pytaniu pokazuje neutralną informację „Analiza equity względem zakresu nie jest jeszcze dostępna”.

Nowa analiza będzie osobnym, małym suplementem do już przeanalizowanego spotu. Nie będzie ponownie generować rekomendowanej akcji, sizingu ani uzasadnienia.

## Kamień milowy 1 — lokalny silnik i podstawowe ćwiczenia

1. **Pełne porównywanie rąk**
   - Rozszerzyć evaluator NLH o wynik porównawczy uwzględniający kickery, remisy i podział puli.
   - Zachować obecne API klasyfikujące układ, aby pozostałe części aplikacji działały bez zmian.

2. **Silnik equity**
   - Obliczać win/tie/loss i equity na preflopie, flopie i turnie.
   - Enumerować wszystkie wyniki do 250 tys. kombinacji; powyżej używać deterministycznej symulacji 100 tys. prób.
   - Zwracać metodę, liczbę prób, 95-procentowy margines błędu i wersję kalkulatora.
   - Wyniki liczyć w tle i zapisywać w cache; pobranie pytania ani render UI nie może uruchamiać kosztownych obliczeń.

3. **Ćwiczenia przeciw znanej ręce**
   - Z historii showdownu odczytywać karty aktywnego rywala, ale udostępniać je wyłącznie w osobnym trybie equity.
   - Używać tylko stanów heads-up, bez przyszłego boardu i wyniku rozdania.
   - Pokazywać ostrzeżenie, że ręka rywala została poznana później i jest ujawniona wyłącznie na potrzeby nauki.
   - Dodać `ExerciseType: "equity_pot_odds"` oraz poziom `known_hand`.
   - Stare spoty mogą być źródłem poziomu `known_hand` bez dodatkowego AI, jeżeli historia zawiera komplet kart rywala.

4. **Odpowiedź i ocenianie**
   - Przedziały equity: `[0,10%)`, `[10,20%)` … `[90,100%]`.
   - Sąsiedni przedział jest „dopuszczalny” tylko do 2 punktów procentowych od granicy; dla symulacji uwzględnić dodatkowo jej margines 95%.
   - Feedback pokazuje wynik, właściwy przedział, win/tie/loss, metodę i dokładność obliczenia.

## Kamień milowy 2 — lekka analiza zakresu i pot odds

5. **Osobny suplement equity**
   - Nie zmieniać kontraktu ani treści istniejących kluczy odpowiedzi v3.
   - Dodać osobny `EquitySupplement`, powiązany z `spotVersionId` oraz dokładnym `answerKeyId`, na podstawie którego powstał.
   - Suplement zawiera jawny ważony zakres rywala, lokalnie policzone equity, wersję kontraktu zakresu, wersję kalkulatora, model i datę utworzenia.
   - Suplement przestaje być aktualny po zmianie bieżącego klucza odpowiedzi, ale stary klucz i zwykłe ćwiczenie pozostają aktywne.

6. **Minimalny kontrakt AI**
   - Analizować wyłącznie spoty, które:
     - są już przeanalizowane pod zwykłe ćwiczenia;
     - mają aktualny gotowy klucz wysokiej pewności;
     - znajdują się w aktywnej, wybranej puli;
     - są heads-up, mają `toCall > 0` i legalny call;
     - nie mają aktualnego suplementu equity.
   - Nie skanować ponownie całego datasetu ani nie wysyłać spotów oczekujących na podstawowy klucz.
   - Do AI przekazywać tylko dane potrzebne do zakresu: karty Hero, widoczny board, pozycje, ulicę, stack efektywny, pot, call, wcześniejsze akcje, scenariusz oraz istniejący tekst `opponentRange` jako podpowiedź.
   - AI zwraca wyłącznie `spotVersionId`, rywala i ważone klasy rąk. Nie generuje ponownie akcji, sizingu, rationale ani liczbowego equity.
   - Zakres używa 169 klas, np. `{ handClass: "AKs", weight: 0.75 }`; dozwolone wagi to `0.25`, `0.5`, `0.75`, `1`.
   - Lokalnie odrzucać duplikaty, błędną notację, pusty zakres i zakres bez legalnych kombinacji. Card removal rozwija klasy do konkretnych kombinacji.
   - Przetwarzać maksymalnie 20 suplementów na żądanie, bez automatycznego płatnego retry.

7. **Sterowanie analizą**
   - W ustawieniach dodać przycisk „Analizuj ponownie z uwzględnieniem equity”.
   - Opis przycisku wyjaśnia, że uzupełnia on tylko dodatkowy aspekt już gotowych ćwiczeń i nie zastępuje ich kluczy.
   - Status pokazuje:
     - gotowe zwykłe spoty kwalifikujące się do suplementu;
     - liczbę już uzupełnionych;
     - liczbę oczekujących;
     - przewidywaną liczbę płatnych żądań;
     - pokrycie według typu ćwiczenia i formatu gry.
   - Rozszerzyć refresh o `scope: "missing_keys" | "equity_supplement"`.
   - `equity_supplement` nie uruchamia skanu historii i nie modyfikuje selekcji aktywnych spotów.
   - Start wymaga modelu i potwierdzenia kosztu; zatrzymanie i wznowienie działają jak w istniejących zadaniach w tle.

8. **Tworzenie trybu „Equity i pot odds”**
   - Dedykowany poziom `range` powstaje tylko ze spotów posiadających aktualny suplement.
   - Poziom `pot_odds` dodatkowo wymaga terminalnej sytuacji heads-up, w której po callu nie ma przyszłych inwestycji, np. call przeciw all-inowi.
   - Nie tworzyć hipotetycznych wartości puli ani calla — używać stanu z prawdziwego rozdania.
   - Spot bez suplementu nie trafia do puli `range` ani `pot_odds`; po późniejszym uzupełnieniu może zostać dodany wyłącznie przez lokalną aktywację opisaną w kamieniu milowym 3.
   - Dodać poziom `mixed`, łączący dostępne `known_hand`, `range` i `pot_odds`.
   - Nowy typ nadal ma maksymalnie 100 aktywnych spotów Cash i 100 turniejowych, z możliwie równym udziałem poziomów.

## Integracja z istniejącymi ćwiczeniami

9. **Zachowanie starych zadań**
   - Zwykłe sesje wybierają spoty dokładnie według dotychczasowej gotowości klucza; suplement equity nie jest warunkiem.
   - Nie zmieniać istniejącej punktacji action-only ani historycznych prób.
   - Aktywna sesja utworzona przed wdrożeniem wznawia się w dotychczasowym przebiegu.
   - Nie resetować kolekcji i nie oznaczać starych kluczy jako wymagających ponownej analizy.

10. **Komunikat o pokryciu equity**
   - W heads-up spocie przed callem bez suplementu pokazać: „Analiza equity względem zakresu nie jest jeszcze dostępna. Możesz normalnie rozwiązać to pytanie”.
   - Dla spotu multiway lub bez calla wyświetlać „Osobna ocena equity nie dotyczy tego typu pytania”, aby nie sugerować brakującego zadania AI.
   - Komunikat nie zmienia układu odpowiedzi i nie blokuje zatwierdzenia akcji.

11. **Dwustopniowe pytanie po uzupełnieniu**
   - Jeżeli istnieje aktualny suplement, pokazać przed odpowiedzią jawny „Założony zakres modelu”.
   - Użytkownik najpierw blokuje przedział equity przyciskiem „Dalej”, a następnie wybiera dotychczasową akcję.
   - Oba pola zapisywać atomowo jednym żądaniem.
   - Zachować oddzielne `equityGrade` i `actionGrade`. Główna ocena zwykłego ćwiczenia nadal odpowiada akcji.
   - Dobór powtórek może używać gorszej z dwóch ocen, aby błąd equity również powodował częstszy powrót spotu.
   - Feedback pokazuje lokalne equity, wymagany próg, różnicę względem progu oraz dotychczasową rekomendację strategiczną.

## Kamień milowy 3 — podpięcie gotowych analiz do ćwiczeń

Analiza suplementów i aktywacja ćwiczeń pozostają dwoma osobnymi etapami. Zakończenie zadania `equity_supplement` zapisuje analizę i tworzy pochodne spoty, ale nadal nie zmienia aktywnej selekcji. Użytkownik uruchamia potem jawny, bezpłatny krok lokalny, który korzysta wyłącznie z danych już zapisanych w bazie: nie skanuje historii, nie wywołuje AI i nie przebudowuje pul pozostałych typów ćwiczeń.

12. **Status kandydatów do aktywacji**
   - Rozszerzyć status treningu o `equityActivation` z liczbą gotowych kandydatów i aktywnych spotów osobno dla Cash i turniejów oraz dla `known_hand`, `range` i `pot_odds`.
   - Kandydatem jest wyłącznie bieżący spot `equity_pot_odds` z aktualnym, gotowym kluczem lokalnym; `mixed` pozostaje filtrem sesji, a nie osobnym spotem.
   - Wyliczać `needsActivation` bez zapisu, porównując identyfikatory obecnie aktywnych spotów equity z deterministycznym wynikiem tej samej selekcji, której użyje aktywacja.
   - Status ma rozróżniać brak analiz od sytuacji „analizy są gotowe, ale pula nie została jeszcze aktywowana”.

13. **Lokalna aktywacja w repozytorium**
   - Dodać idempotentną operację repozytorium, która synchronizuje pochodne spoty z istniejących suplementów i przebudowuje wyłącznie selekcję `equity_pot_odds`.
   - Użyć wspólnej deterministycznej funkcji selekcji także do podglądu `needsActivation`, aby status i zapis nie mogły wskazywać różnych zestawów.
   - Wybrać maksymalnie 100 spotów Cash i 100 turniejowych, możliwie równomiernie pomiędzy dostępnymi poziomami `known_hand`, `range` i `pot_odds`.
   - Zapisać wybrane spoty jako aktywne i gotowe do sesji zarówno w repozytorium SQLite, jak i w zgodnym repozytorium plikowym używanym przez testy i migrację.
   - Zachować bez zmian identyfikatory i aktywność selekcji wszystkich starych typów ćwiczeń, istniejące sesje, próby oraz klucze odpowiedzi.
   - Operacja nie może czytać kanonicznej historii rozdań ani wykonywać wywołań AI.

14. **Endpoint aktywacji**
   - Dodać `POST /api/training/equity/activate`, który uruchamia wyłącznie lokalną operację z zadania 13 i zwraca wynik selekcji oraz odświeżony status treningu.
   - Zablokować aktywację na czas działającego zadania refresh, aby nie ścigała się z zapisem kolejnych suplementów; po statusie `completed` ma być dostępna od razu.
   - Wielokrotne wywołanie bez zmian danych ma zachować ten sam zestaw aktywnych spotów i nie tworzyć duplikatów.

15. **Aktywacja w ustawieniach AI**
   - W panelu suplementów pokazać jednoznaczny stan „Analizy gotowe — aktywuj ćwiczenia”, gdy istnieją kandydaci, ale pula equity jest pusta lub wymaga lokalnej przebudowy.
   - Dodać przycisk „Aktywuj ćwiczenia equity” z informacją, że operacja jest lokalna, bez kosztu AI i nie zmienia starych ćwiczeń.
   - Po zakończeniu zadania `equity_supplement` pobrać pełny status, zamiast aktualizować tylko obiekt zadania, aby od razu pojawiły się nowe liczniki i przycisk aktywacji.
   - Po aktywacji odświeżyć status i pokazać liczbę aktywnych spotów według formatu i poziomu.

16. **Odblokowanie startu w widoku ćwiczeń**
   - Gdy kandydaci istnieją, ale nie ma aktywnych spotów, zastąpić ogólny brak dostępności komunikatem wyjaśniającym, że analizy są gotowe i wymagają lokalnej aktywacji.
   - Dodać w setupie przycisk „Aktywuj ćwiczenia equity”, uruchamiający ten sam bezpłatny endpoint co panel ustawień.
   - Po aktywacji ponownie pobrać status i odblokować start sesji dla faktycznie dostępnych poziomów; niedostępny poziom nadal pozostaje wyłączony z podaną przyczyną.
   - Potwierdzić, że `mixed` korzysta ze wszystkich aktywnych poziomów, a `range` i `pot_odds` nie zawierają spotów bez aktualnego suplementu.

17. **Test przepływu aktywacji**
   - Test repozytorium i API ma przygotować gotowe suplementy, wykonać aktywację bez skanu i bez mockowanego wywołania dostawcy AI, a następnie utworzyć sesje `known_hand`, `range`, `pot_odds` i `mixed` tam, gdzie istnieją kandydaci.
   - W tym samym teście porównać identyfikatory aktywnych spotów starych typów przed i po operacji oraz wznowić wcześniej utworzoną zwykłą sesję.
   - Test UI ma objąć stan przed aktywacją, kliknięcie przycisku, odświeżenie liczników i odblokowanie startu ćwiczenia.
   - Po testach celowanych uruchomić jeden końcowy zestaw: `npm test`, `npm run lint` i `npm run build`.

## Interfejsy i dane

- Tworzenie sesji rozszerzyć o `equityMode: "known_hand" | "range" | "pot_odds" | "mixed"`, dozwolone tylko dla `equity_pot_odds`.
- Status treningu rozszerzyć o `equityActivation`, a lokalną aktywację udostępnić przez `POST /api/training/equity/activate`.
- Pytanie może zawierać `equityPrompt`, ale nigdy obliczonego wyniku.
- Odpowiedź przyjmuje `{ spotVersionId, equityBucket?, answer? }`; stare żądania z samym `answer` pozostają prawidłowe.
- Feedback może zawierać `equity`, `equityGrade` i `actionGrade`; stare odpowiedzi API zachowują dotychczasowe pola.
- W SQLite wykonać addytywną migrację:
  - nowa tabela `equity_supplements`;
  - `source_spot_version_id` i `equity_mode` dla pochodnych spotów;
  - `equity_mode` dla sesji;
  - `equity_bucket`, `equity_grade` i `action_grade` dla prób;
  - `job_kind` dla zadań refresh.
- Rekordy historyczne otrzymują wartości `null`; nie wymagają przeliczenia ani migracji zawartości kluczy.
- Statystyki equity liczyć osobno, bez zmiany historycznych statystyk poprawności akcji.

## Testy i kryteria odbioru

1. Po silniku przetestować kickery, remisy, card removal, ważone zakresy, wyniki referencyjne oraz deterministyczność symulacji.
2. Po migracji potwierdzić, że stara baza, sesje, próby i klucze działają bez suplementów.
3. Testy usługi mają wykazać, że brak suplementu:
   - nie usuwa zwykłego spotu;
   - nie blokuje odpowiedzi;
   - nie dodaje go do `range` ani `pot_odds`;
   - zwraca prawidłowy komunikat o braku analizy.
4. Mocki AI sprawdzają minimalny payload, brak ponownego generowania akcji, walidację zakresu, partie po 20 i zachowanie starego zadania po błędzie suplementu.
5. Testy UI obejmą action-only, komunikat o braku equity, dwustopniową odpowiedź po uzupełnieniu, nowy setup poziomów i wznowienie starej sesji.
6. Na końcu uruchomić `npm test`, `npm run lint` i `npm run build`; automatyczne testy nie wykonują prawdziwych wywołań AI.

## Założenia

- Liczbowe equity v1 obejmuje wyłącznie NLH heads-up.
- Zakres modelu jest jawnym założeniem trenerskim, nie wynikiem solvera.
- Dedykowane pot odds korzystają wyłącznie z terminalnych sytuacji, bez rake i przyszłych betów.
- Brak suplementu oznacza wyłącznie brak nowej funkcji edukacyjnej, nigdy brak gotowości dotychczasowego ćwiczenia.
