# Selekcja ograniczonego zestawu ćwiczeń przed analizą AI

## Podsumowanie

Lokalny skan nadal przejrzy istniejące rozdania, ale przed zapisem i wysłaniem do AI wybierze maksymalnie 100 spotów dla każdej kombinacji: 4 typy ćwiczeń × Cash/Turnieje. Maksimum jednego zadania wyniesie więc 800 spotów, czyli 40 żądań po 20 spotów.

Wybrany zestaw będzie stały. Kolejne skany tylko uzupełnią braki; pełna wymiana nastąpi wyłącznie po świadomym użyciu funkcji przebudowy.

## Zadania implementacyjne

1. Dodać deterministyczny selektor `diverse_recent_v1`.

   - Odrzucać spoty niespełniające kontraktu AI, mające mniej niż dwie poprawne odpowiedzi albo niespójny stan gry.
   - Dzielić kandydatów według pozycji Hero, zakresu stacka, liczby rywali oraz cechy ćwiczenia: scenariusza 3-bet, etapu c-betu albo ulicy turn/river.
   - Wybierać round-robin między grupami, a wewnątrz grup preferować najnowsze rozdania.
   - Nie wybierać wielu niezależnych decyzji z jednego rozdania. Epizody flop–turn dla c-betów traktować jako jedną jednostkę i nie rozdzielać ich.
   - Nigdy nie przekraczać 100 spotów w jednej z 8 pul.

2. Przerobić zapis kolekcji.

   - Dodać zgodny wstecznie `selectionState` z wersją strategii, datą wyboru, limitem i identyfikatorami wybranych spotów.
   - Przy zwykłym skanie zachowywać istniejący wybór, usuwać z niego nieaktualne wersje i uzupełniać wyłącznie wolne miejsca.
   - Przy pierwszym skanie po aktualizacji wybrać zestaw z obecnych 26 742 kandydatów i atomowo usunąć niewybrane, nieużywane migawki.
   - Zachować starsze spoty i klucze wymagane przez aktywne sesje, próby oraz możliwe do wznowienia zadanie AI.
   - Blokować przebudowę, jeśli istnieje niedokończone zadanie AI możliwe do wznowienia.

3. Ograniczyć kolejkę AI do wybranego zestawu.

   - `estimateTrainingRefresh` ma uwzględniać tylko wybrane spoty bez klucza, ewentualnie wybrane spoty `review`.
   - Zachować partie po 20, natychmiastowy zapis poprawnych odpowiedzi i brak automatycznych ponowień.
   - Jedno zadanie nie może przekroczyć 800 kandydatów ani 40 żądań.
   - Ponownie sprawdzać kontrakt przed utworzeniem zadania, aby lokalnie błędny spot nie przerwał płatnej pracy.

4. Zmienić API i panel ustawień.

   - Rozszerzyć `POST /api/training/refresh/scan` o `rebuildSelection: boolean`.
   - Status kolekcji ma zwracać strategię, datę wyboru oraz dla każdej puli: liczbę pasujących, wybranych, gotowych, oczekujących i odrzuconych lokalnie.
   - Zwykły przycisk ma skanować i uzupełniać stały zestaw.
   - Dodać osobną, ostrzegającą akcję „Przebuduj zestaw”; po lokalnej przebudowie nadal wymagane będzie oddzielne potwierdzenie płatnych żądań.
   - W potwierdzeniu pokazywać dokładną liczbę wybranych spotów, podział na pule i maksymalną liczbę żądań.
   - Sesje ćwiczeń nadal korzystają wyłącznie ze spotów z gotowym kluczem wysokiej pewności.

5. Uaktualnić opis architektury w `plans/cwiczenia-poker.md`, wskazując, że limit obowiązuje przed analizą AI, a nie dopiero podczas tworzenia aktywnej puli.

## Testy

- Test selektora: limit 100, deterministyczność, preferowanie nowszych spotów, reprezentacja różnych kontekstów, brak duplikowania rozdań i nierozdzielanie epizodów c-bet.
- Test repozytorium: pierwszy wybór, stabilny ponowny skan, uzupełnianie braków, świadoma przebudowa i bezpieczne usunięcie obecnych niewybranych kandydatów.
- Test kolejki AI: maksymalnie 800 spotów/40 żądań, brak niewybranych lub lokalnie błędnych spotów w payloadzie oraz ograniczenie ponownej analizy do wybranego zestawu.
- Test API i UI: nowe statystyki, flaga przebudowy, blokada przy niedokończonym zadaniu i poprawna estymacja kosztu.
- Po implementacji uruchomić raz testy modułu treningowego, następnie pełny zestaw testów, lint i build.

## Założenia

- Limit wynosi 100 osobno dla każdego typu ćwiczenia i formatu gry.
- Limit dotyczy spotów wysłanych do modelu, więc błędne lub mało pewne odpowiedzi AI nie są automatycznie zastępowane kolejnymi płatnymi kandydatami.
- Skan i selekcja są bezpłatne; AI uruchamia się wyłącznie po oddzielnym potwierdzeniu.
- Niewybrane spoty można w przyszłości odzyskać przez ponowny skan kanonicznych rozdań — nie trzeba przechowywać ich pełnych migawek w pliku treningowym.
