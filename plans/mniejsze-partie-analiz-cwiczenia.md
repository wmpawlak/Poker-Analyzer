# Mniejsze, kolejne partie analiz do ćwiczeń

## Podsumowanie

- Domyślna próbka będzie wynosić 100 spotów zamiast 800.
- Użytkownik wybierze: 100, 200, 300, 400, 500, 600, 700 albo 800 spotów.
- Żądania do AI pozostaną podzielone na paczki po maksymalnie 20 spotów.
- Każde nowe zadanie użyje wyłącznie spotów, które nigdy wcześniej nie zostały wysłane do AI.
- Kolekcja będzie dopisywana bez usuwania istniejących kluczy, ćwiczeń, sesji i wyników.

## Zmiany implementacyjne

1. Dodać wybór wielkości próbki obok przycisku „Odśwież kolekcję”, domyślnie 100. Estymacja pokaże faktyczną liczbę spotów i żądań, np. `100 spotów / 5 żądań`.

2. Przekazywać `sampleSize` przez status, lokalny skan i start zadania. Backend zaakceptuje wyłącznie wielokrotności 100 od 100 do 800; końcowe zadanie może być mniejsze, jeśli zabraknie nowych spotów.

3. Zastąpić obecny limit całego zadania limitem wybranym przez użytkownika. Wielkość paczki AI pozostanie stała: 20 spotów.

4. Dodać trwałe oznaczenie pierwszego wysłania spotu do AI. Spot zostanie oznaczony przed wywołaniem dostawcy, dlatego nie wróci do kolejki również po błędzie, przerwaniu lub restarcie aplikacji.

5. Przy migracji istniejącej kolekcji uznać za wykorzystane:

   - spoty posiadające klucz odpowiedzi,
   - spoty przetworzone według kursora wcześniejszych zadań,
   - spoty zapisane jako będące w trakcie przerwanego żądania.

   Pozostałe spoty zachować jako niewysłane.

6. Kandydatów wybierać spośród wszystkich aktualnych, poprawnych i nigdy niewysłanych spotów. Selekcja będzie przechodziła od najnowszych do starszych, z round-robin pomiędzy typami ćwiczeń i formatami gry, aby próbka nie została zdominowana przez jedną kategorię. Powiązane etapy ćwiczenia c-bet pozostaną kompletną sekwencją.

7. Zachowywać wszystkie przeanalizowane przypadki. Lokalny skan będzie dopisywał nowe i odtwarzał starsze, wcześniej pominięte spoty bez czyszczenia istniejącej kolekcji. Zmienione źródłowe rozdanie będzie traktowane jako nowa wersja spotu.

8. Usunąć opcję wysyłania „Ponownej analizy”. Spoty wymagające kontroli pozostaną widoczne w statystykach, ale standardowe zadanie AI nigdy ich ponownie nie wyśle.

9. Nie pozwalać uruchomić drugiego zadania, gdy poprzednie można jeszcze wznowić. Najpierw trzeba je dokończyć przyciskiem „Wznów”, co zapobiegnie nakładaniu się kolejek.

## Co klikać po wdrożeniu

1. Wejdź w `Ustawienia → Kolekcja ćwiczeń`.
2. Wybierz liczbę spotów, domyślnie `100`.
3. Kliknij `Odśwież kolekcję` — to tylko bezpłatny lokalny skan.
4. Sprawdź estymację, np. `100 spotów w 5 żądaniach po 20`.
5. Kliknij `Potwierdź analizę AI`.
6. Poczekaj na status `Zakończone`.
7. Aby przygotować następną próbkę, ponownie kliknij `Odśwież kolekcję`, sprawdź estymację i potwierdź. System automatycznie pominie wszystkie wcześniej wysłane spoty.
8. Nie używaj `Przebuduj zestaw`, `Wyczyść analizy AI` ani `Pełny reset`, jeśli chcesz zachować istniejącą kolekcję.

W aktualnej wersji nie da się niezawodnie ograniczyć zadania do dokładnie 100 spotów — obecne potwierdzenie może uruchomić do 800. Do czasu wdrożenia zmiany nie należy uruchamiać odświeżenia, jeśli limit 100 jest istotny.

## Interfejsy i zgodność

- `GET /api/training/status?sampleSize=100`
- `POST /api/training/refresh/scan` z `sampleSize`
- `POST /api/training/refresh/start` z tym samym `sampleSize`
- Odpowiedzi statusu i zadania pokażą wybrany limit, faktyczną liczbę kandydatów oraz liczbę paczek.
- Migracja nastąpi automatycznie, bez resetowania obecnej kolekcji.

## Testy akceptacyjne

- Domyślnie wybieranych jest maksymalnie 100 spotów i powstaje najwyżej 5 paczek.
- Każda wartość 100–800 daje poprawną liczbę paczek po 20; inne wartości są odrzucane.
- Kolejne zadanie nie zawiera żadnego wcześniej wysłanego `spotVersionId`.
- Po próbce 100 następna próbka pobiera kolejne niewysłane spoty.
- Przy mniejszym zapasie wysyłane są wszystkie pozostałe spoty.
- Błąd lub restart podczas żądania nie powoduje ponownej wysyłki tej samej paczki.
- Istniejące klucze, ćwiczenia, sesje i próby pozostają nienaruszone po skanie oraz kolejnych zadaniach.
- Selekcja zaczyna od najnowszych spotów i utrzymuje balans kategorii.
- Test UI sprawdza wybór próbki, estymację, blokadę równoległego zadania i instrukcję wznowienia.
