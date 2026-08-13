# Szybki moduł ćwiczeń oparty na SQLite

## Podsumowanie

- Zastąpić monolityczny `poker-training-v1.json` bazą `data/poker-training-v2.sqlite`.
- Zachować cały katalog spotów dla przyszłych partii AI, ale nigdy nie kopiować go w całości podczas zwykłej sesji.
- Przy tworzeniu sesji wybrać ostateczne 10/20/50/100 spotów i zapisać tylko ich uporządkowane ID.
- Status, historia, statystyki, pytania i odpowiedzi mają wykonywać małe zapytania indeksowane.
- Dotychczasowy JSON zostanie automatycznie zmigrowany przy starcie i zachowany jako kopia bezpieczeństwa.

## Zadania implementacyjne

1. Dodać magazyn SQLite przez wbudowane `node:sqlite`, wymagając Node 24+. Włączyć `foreign_keys`, WAL i `busy_timeout`; ignorować pliki `.sqlite`, `-wal`, `-shm` oraz backup migracyjny.

2. Utworzyć wersjonowany schemat:

   - `spots` — identyfikatory, typ ćwiczenia, format, daty, status źródła, gotowość, aktywność, oznaczenie wysłania do AI i JSON z treścią pytania;
   - `answer_keys` — klucze przypisane do `spotVersionId`;
   - `sources` i `source_history` — stan skanowania oraz fingerprinty;
   - `selected_spots` — maksymalnie 100 aktywnych spotów na typ ćwiczenia i format;
   - `refresh_jobs` oraz uporządkowane `refresh_job_spots`;
   - `sessions`, uporządkowane `session_spots` i `attempts`;
   - `audit_exclusions` oraz tabela metadanych kolekcji.

   Dodać indeksy dla typu ćwiczenia, formatu, aktywności, gotowości, `playedAt`, `handId`, `spotVersionId`, statusu zadania i historii prób.

3. Przy pierwszym starcie wykonać transakcyjną migrację JSON → SQLite:

   - zachować wszystkie spoty, klucze, znaczniki `aiFirstSentAt`, zadania, sesje, próby, selekcję, audyt i stan skanowania;
   - sprawdzić liczby rekordów, relacje i `PRAGMA integrity_check`;
   - oznaczyć bazę jako kompletnie zmigrowaną dopiero po pełnym sukcesie;
   - po sukcesie zmienić nazwę JSON-u na datowaną kopię migracyjną;
   - po przerwaniu pozostawić JSON nietknięty i ponowić bez duplikowania danych;
   - kompletna baza SQLite zawsze ma pierwszeństwo przed pozostawionym JSON-em.

4. Zastąpić pełne `getSnapshot()` i `transact()` metodami wykonującymi zapytania zakresowe. Pełny eksport kolekcji pozostawić wyłącznie dla testów, diagnostyki i kopii bezpieczeństwa — żadna ścieżka HTTP nie może go używać.

5. Przy skanie przeliczać tylko nowe, zmienione, niekompletne albo zapisane starszą wersją ekstraktora rozdania. Dla niezmienionych źródeł porównać fingerprint, wersję ekstraktora i oczekiwaną liczbę spotów bez ponownego parsowania historii. Selekcję aktywnej puli aktualizować indeksowanymi zapytaniami.

6. Wyliczać lokalną poprawność spotu podczas skanu i zapisywać wynik w bazie. Status i estymacja kolejki AI mają pobierać najwyżej wybrany limit 100–800 kandydatów bez ponownej walidacji wszystkich spotów.

7. Przy tworzeniu sesji:

   - pobrać tylko aktywną pulę dla wybranego `exerciseType + gameType`;
   - uwzględnić ostatnią próbę każdego kandydata;
   - najpierw wybierać niewidziane spoty, później stosować wagi `incorrect 4×`, `acceptable 2×`, `correct 1×` i unikać natychmiastowej powtórki;
   - zapisać finalną, uporządkowaną listę maksymalnie 10/20/50/100 ID w `session_spots`;
   - traktować wieloetapowy epizod c-bet jako całość i zachować kolejność flop → turn; jeśli cały epizod nie mieści się w limicie, pominąć go, a `targetSize` ustawić na faktycznie wybraną liczbę.

8. `GET next` ma odczytywać wyłącznie bieżący wpis `session_spots`, jeden spot i jeden klucz. Powtórne pobranie tego samego pytania ma być tylko odczytem. Zapis odpowiedzi ma atomowo dopisać jedną próbę i przesunąć pozycję sesji, bez przepisywania katalogu.

9. Status, historia i statystyki pozostają zgodne z obecnym API, lecz powstają przez agregacje SQL. Interfejs React nie otrzymuje katalogu spotów i nie wymaga zmian kontraktu odpowiedzi.

## Testy i kryteria akceptacyjne

- Migracja zachowuje dokładne liczby oraz identyfikatory spotów, kluczy, zadań, sesji i prób; restart nie importuje danych ponownie.
- Awaria migracji pozostawia działający JSON i niekompletną bazę, która nie staje się źródłem prawdy.
- Sesja zawiera wyłącznie finalnie wybrane spoty właściwego typu i formatu.
- Zachowane są reguły niewidzianych spotów, wag 4×/2×/1×, braku natychmiastowej powtórki i kompletności c-bet.
- Pobranie następnego pytania jest idempotentne, a odpowiedź zapisuje próbę i postęp w jednej transakcji.
- Kolejka AI nadal pomija wszystkie wcześniej wysłane spoty i blokuje drugie zadanie wymagające wznowienia.
- Skan niezmienionego datasetu nie uruchamia ekstraktora dla każdego rozdania.
- Test na bazie co najmniej 25 tys. spotów potwierdza, że ścieżki statusu, sesji, pytania i odpowiedzi nie wykonują pełnego eksportu ani pełnego skanu tabeli.
- Na obecnym komputerze: ciepły status i akcje sesji poniżej 250 ms, początkowe załadowanie modułu poniżej 1 s; osobno raportować czas jednorazowej migracji i lokalnego skanu.

## Założenia

- SQLite przechowuje pełny katalog kandydatów, ponieważ jest potrzebny do kolejnych analiz AI; ograniczenie dotyczy danych odczytywanych przez konkretną sesję.
- Publiczne endpointy i format odpowiedzi pozostają kompatybilne.
- SQLite jest jedynym źródłem prawdy po migracji; backup JSON służy wyłącznie do ręcznego odzyskania.
- Nie scalać spotów tylko na podstawie kart startowych — pozycja, stack, wcześniejsze akcje, board i sizing pozostają częścią unikalnego przypadku.
