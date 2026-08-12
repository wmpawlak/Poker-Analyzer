# Uszczelnienie modułu ćwiczeń i zarządzania pamięcią

## Podsumowanie

- Źródłowe karty są zapisane poprawnie; błąd powstaje podczas interpretacji przez AI.
- Audyt 160 kluczy wykazał co najmniej 6 błędnych rozpoznań, m.in. `A3o → A3s`, `A2o → A2s`, `ATo → ATs` i `K8o → K8s`.
- Wszystkie klucze ze starego kontraktu zostaną unieważnione. Ponowna analiza nie uruchomi się automatycznie ani bez potwierdzenia kosztu.
- Trwającą sesję będzie można przerwać z zachowaniem odpowiedzi w historii.
- Ustawienia otrzymają dwa poziomy czyszczenia pamięci.
- Zapis kolekcji dostanie obsługę przejściowych blokad pliku na Windowsie.

## Zadania implementacyjne

1. **Jednoznaczna klasyfikacja kart**
   - Wyliczać lokalnie z kart Hero zapis, np. `A3o`, `ATs`, `QQ`, oraz klasę `offsuit`, `suited` lub `pair`.
   - Do każdego spotu wysyłanego do AI dodawać te pola jako autorytatywne fakty.
   - Podnieść kontrakt kluczy do wersji 2 i wymagać od AI zwrotu rozpoznanego zapisu oraz klasy ręki.
   - Odrzucać klucz, jeżeli zwrócone pola nie zgadzają się z kartami albo uzasadnienie/blockery zawierają przeciwny zapis, np. `A3s` przy `A3o`.
   - Nie mylić poprawnych wzmianek o suited rękach z zakresu rywala z opisem ręki Hero.

2. **Migracja obecnych analiz**
   - Klucze z kontraktu v1 zachować jedynie jako historyczne odniesienie dla wykonanych prób, ale wyłączyć je z oceniania nowych odpowiedzi.
   - Wszystkie odpowiadające im spoty oznaczyć jako oczekujące na nowy klucz v2.
   - Aktywne zadanie AI v1 oznaczyć jako `superseded`, aby nie można było go przypadkowo wznowić.
   - Aktywne sesje oparte na starych kluczach przerwać, zachowując już wykonane próby.
   - Nowa analiza nadal będzie wymagała pokazania estymacji i ręcznego potwierdzenia.

3. **Przerywanie sesji**
   - Dodać `POST /api/training/sessions/:sessionId/abandon`.
   - Sesja otrzyma status `abandoned`, czas przerwania i wyczyszczone bieżące pytanie; jej próby pozostaną w historii i statystykach.
   - Próba wznowienia, pobrania kolejnego pytania lub udzielenia odpowiedzi w przerwanej sesji zwróci czytelny błąd.
   - W aktywnym ćwiczeniu dodać przycisk „Przerwij sesję” z potwierdzeniem.
   - Po przerwaniu usunąć identyfikator sesji z `localStorage` i wrócić do wyboru ćwiczenia.

4. **Dwa poziomy czyszczenia**
   - Dodać `POST /api/training/reset` z `scope: "answer_keys" | "all"` i wymaganym `confirmed: true`.
   - „Wyczyść analizy AI” usunie klucze i zadania AI, pozostawi zeskanowane spoty oraz próby, a aktywne sesje oznaczy jako przerwane.
   - „Pełny reset ćwiczeń” wyzeruje spoty, klucze, zadania, sesje, próby i stan skanowania. Źródłowe historie rozdań pozostaną nietknięte.
   - Reset będzie zablokowany podczas faktycznie działającego zadania AI; użytkownik najpierw zatrzyma zadanie.
   - W ustawieniach dodać osobną sekcję ostrzegawczą z licznikami usuwanych rekordów i dwuetapowym potwierdzeniem.

5. **Naprawa błędu `EPERM`**
   - Dla `EPERM`, `EACCES` i `EBUSY` ponawiać atomowy `rename` maksymalnie 10 razy z rosnącym opóźnieniem, ograniczonym do 1 sekundy.
   - Po wyczerpaniu prób zwracać kontrolowany błąd `TRAINING_COLLECTION_WRITE_FAILED`, zachowując poprzedni poprawny plik.
   - Zawsze usuwać plik tymczasowy bieżącego zapisu.
   - Przy uruchomieniu repozytorium usuwać wyłącznie pasujące pliki `.poker-training-v1.json.*.tmp` starsze niż godzinę.
   - Błąd zapisu mapować na HTTP 503 i nie pokazywać użytkownikowi pełnej wewnętrznej ścieżki systemowej.

## Interfejsy i typy

- Nowy status sesji: `abandoned` oraz pole `abandonedAt`.
- Nowy kontrakt AI v2 zawierający `heroHand.notation` i `heroHand.class` w wejściu oraz ich wymagane potwierdzenie w odpowiedzi.
- Status kolekcji rozszerzyć o liczbę spotów, kluczy, zadań, sesji i prób, aby potwierdzenia resetu pokazywały dokładny zakres.
- Status zadania `superseded` traktować jako terminalny i wyświetlać jako „Zastąpione nowszym kontraktem”.

## Testy

- Klasyfikacja `A3o`, `ATs`, par oraz odwróconej kolejności kart.
- Odrzucenie odpowiedzi AI opisującej offsuit jako suited i odwrotnie.
- Brak fałszywego odrzucenia, gdy suited ręka występuje wyłącznie w zakresie rywala.
- Unieważnienie wszystkich kluczy v1 oraz zamknięcie starego zadania bez automatycznego requestu AI.
- Przerwanie sesji zachowuje próby, usuwa aktywne pytanie i uniemożliwia wznowienie.
- Oba zakresy resetu oraz blokada resetu podczas aktywnego zadania.
- Symulowane przejściowe `EPERM`: zapis kończy się sukcesem po ponowieniach i nie pozostawia `.tmp`.
- Trwały błąd zapisu zachowuje poprzednią kolekcję.
- Testy UI przycisków, potwierdzeń i czyszczenia `localStorage`.
- Na końcu pełny zestaw testów, lint i build.

## Założenia

- Przerwanie sesji nie usuwa wykonanych odpowiedzi ani ich ocen.
- Pełny reset dotyczy wyłącznie `poker-training-v1.json`; nie usuwa historii rozdań ani zwykłych analiz pokerowych.
- Po unieważnieniu starych kluczy użytkownik sam uruchamia skan/analizę i akceptuje oszacowaną liczbę płatnych żądań.
