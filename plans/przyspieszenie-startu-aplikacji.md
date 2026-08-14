# Szybki start aplikacji i końcowa aktualizacja baz po wdrożeniu equity

## Podsumowanie

Najpierw zakończyć `plans/equity--pot-odds.md` i ustabilizować jego finalne wersje: obecnie schemat treningowy v5 oraz extractor v2. Następnie utwardzić migrację, dodać powtarzalne narzędzie aktualizujące rzeczywistą bazę, odroczyć moduł treningowy i dopiero na końcu kontrolowanie zmigrować śledzoną bazę SQLite oraz odbudować cache Vite.

Nie zmieniać formatu kanonicznych JSONL, cache AI ani `PARSER_VERSION`, ponieważ aktualne zmiany equity nie modyfikują wyniku `parseSingleRawHand`.

## Zmiany implementacyjne

1. **Punkt integracyjny po equity**
   - Rozpocząć ten plan dopiero po przejściu testów planu equity i ustaleniu finalnych `TRAINING_SCHEMA_VERSION` oraz `TRAINING_EXTRACTOR_VERSION`.
   - Przyjąć obecne wartości v5 i v2; nie dodawać kolejnej wersji schematu dla samej optymalizacji startu.

2. **Utwardzenie migracji v5**
   - Migracja ma idempotentnie doprowadzać dowolną obsługiwaną bazę v1–v4 do pełnego kształtu v5, bez warunków pomijających kolumny przy skoku przez kilka wersji.
   - Po migracji zsynchronizować trzy źródła wersji: `PRAGMA user_version`, maksymalną wersję w `schema_migrations` i `collection_metadata.schema_version`.
   - Historyczne próby zachować bez zmian; nowe pola equity/action pozostawić jako `NULL`.
   - Nie resetować sesji, kluczy, selekcji ani zadań refresh.

3. **Kontrolowany migrator treningowy**
   - Dodać `npm run training:migrate -- --dry-run|--apply`.
   - `--dry-run` raportuje wersje, brakujące elementy schematu, rewizję datasetu, rozkład wersji extractora i potrzebę reskanu bez zapisu.
   - `--apply` tworzy spójną kopię SQLite w ignorowanym `data/.backups/`, wykonuje migrację i backfille repozytorium, a następnie skanuje kanoniczne rozdania extractorem v2 z `rebuildSelection: false`.
   - Reskan uruchamiać tylko, gdy źródła mają starszy extractor lub inną rewizję datasetu; ponowne `--apply` ma być idempotentne.
   - Migrator nie tworzy refresh service, nie wznawia zadań i nie wykonuje wywołań AI.

4. **Leniwe uruchamianie treningu**
   - W `createApiApp` tworzyć repozytorium, refresh service, training service i router dopiero przy pierwszym `/api/training/*`.
   - Zapamiętać jedną instancję runtime’u dla wszystkich kolejnych żądań i zachować istniejące opcje wstrzykiwania zależności.
   - Automatyczne odzyskanie zadania AI rozpoczynać dopiero po pierwszym wejściu do „Ćwiczeń”.
   - Błąd inicjalizacji zwracać jako JSON `TRAINING_INTERNAL_ERROR`; nie zmieniać kontraktów HTTP.

5. **Końcowe wdrożenie danych**
   - Zatrzymać wszystkie dev-serwery, wykonać `training:migrate -- --dry-run`, a następnie `--apply` na śledzonej `data/poker-training-v2.sqlite`.
   - Nie uruchamiać `data:migrate -- --apply`, jeśli dry-run nadal pokazuje brak starych plików TXT; uniknąć niepotrzebnej zmiany cache AI.
   - Usunąć wyłącznie pochodny cache `node_modules/.vite`, uruchomić jedną instancję dev-serwera i pozwolić Vite odbudować zależności.
   - Cache indeksu pokerowego pozostawić, jeśli jego rewizja odpowiada JSONL; w przeciwnym razie odbudować go jako ignorowany artefakt.

## Interfejsy i wynik końcowy

- Nowy interfejs operatorski: `npm run training:migrate -- --dry-run|--apply`.
- Brak zmian publicznego API aplikacji i formatów frontendowych.
- Śledzona baza SQLite ma zostać zapisana w repo przez Git LFS w finalnej wersji schematu.
- Stan końcowy dla obecnych wersji: schemat v5 we wszystkich metadanych, extractor v2 dla wszystkich 19 340 źródeł, aktualna rewizja datasetu oraz utworzone lokalne spoty `known_hand`, jeśli rozdania się kwalifikują.
- Backupy, pliki WAL/SHM i cache pozostają poza repozytorium.

## Testy i kryteria odbioru

- Przetestować migracje z fixture’ów v1, v3 i v4 do v5, w tym skok v3→v5 oraz zgodność wszystkich trzech źródeł wersji.
- Sprawdzić dry-run bez zmian plików, apply z backupem, zachowanie liczby sesji/prób i idempotentny drugi apply.
- Potwierdzić, że reskan v1→v2 zachowuje istniejące aktywne selekcje i sesje, a dodaje kwalifikujące się spoty equity.
- Dodać test, że endpoint nietreningowy nie otwiera bazy treningowej, a dwa równoczesne żądania treningowe tworzą jeden runtime.
- Uruchamiać testy etapami: najpierw migracje i API treningowe, następnie pełne `npm test`, `npm run lint` i `npm run build` tylko raz na końcu.
- Na rzeczywistej bazie potwierdzić `integrity_check = ok`, pusty `foreign_key_check`, obecność kolumn v5, zgodność rewizji i brak utraty historycznych rekordów.
- Po restarcie sprawdzić HTTP 200 dla modułów DayPicker, poprawny import `ProfileViews.jsx` oraz start serwera bez inicjalizacji treningu; celem na tej maszynie jest zejście z około 14,7 s do poniżej 2 s przed pierwszym żądaniem danych.

## Założenia

- Plan equity zostanie ukończony przed migracją rzeczywistej bazy.
- Zadania treningowe mogą czekać ze wznowieniem do wejścia użytkownika do zakładki.
- Fizyczna migracja śledzonej bazy jest częścią planu, a backup pozostaje lokalny i ignorowany.
- Przebudowa formatu `payload_json`, optymalizacja pamięci indeksu i redukcja żądań startowych pozostają na późniejszy etap.
