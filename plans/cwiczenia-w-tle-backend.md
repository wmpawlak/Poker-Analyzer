# Odporne zadania przygotowania ćwiczeń w tle

## Diagnoza i cel

- Samo odświeżenie strony nie usuwa joba: praca wykonuje się w backendzie, a Ustawienia odtwarzają status z SQLite.
- Restart backendu zatrzymuje obecny worker. Job pozostaje oznaczony jako `running`, ale nie jest automatycznie podejmowany.
- Obecnie kursor przesuwa się przed odpowiedzią AI, więc restart może bezpowrotnie pominąć bieżącą partię do 20 spotów.
- Job `training-refresh-016ae40d-4550-40f0-9ef0-1a532a0a83f8` nie istnieje w aktualnej bazie ani w kluczach odpowiedzi. Baza zawiera tylko dwa zakończone joby z 12 sierpnia. F5 tego nie tłumaczy; możliwe są reset, migracja/odtworzenie magazynu albo połączenie z inną instancją. Brakuje trwałego dziennika, aby rozstrzygnąć to wstecz.
- Docelowo po jednym potwierdzeniu kosztu można zamknąć lub odświeżyć przeglądarkę i używać reszty aplikacji. Backend kontynuuje pracę, a po swoim restarcie automatycznie ją odzyskuje.

## Zadania implementacyjne

1. **Poprawić semantykę postępu partii**
   - `cursor` i `processedSpotCount` mają oznaczać wyłącznie trwale zakończone lub świadomie pominięte spoty.
   - Przed wywołaniem AI zapisywać `inFlight`, ale nie przesuwać kursora.
   - Po odpowiedzi zapisywać klucze, przesunięcie kursora i wyczyszczenie `inFlight` w jednej transakcji.
   - Jawny błąd dostawcy nadal zapisuje odrzucone klucze, przesuwa partię i ustawia `failed`; nie wprowadzać nieskończonych automatycznych retry.

2. **Dodać automatyczne odzyskiwanie po restarcie**
   - Przy starcie serwera wyszukać zapisany job `running` i uruchomić go od ostatniego zatwierdzonego kursora.
   - Jeśli pozostało `inFlight`, ponowić dokładnie tę samą partię. Dopuszczamy potencjalnie jedno dodatkowo płatne żądanie, aby nie zgubić spotów.
   - `stop_requested` po restarcie zamienić na `stopped`, respektując wcześniejszą decyzję użytkownika.
   - Joby `failed` i ręcznie `stopped` pozostawić do ręcznego wznowienia.
   - Zachować blokadę uruchomienia drugiego joba, dopóki pierwszy ma pracę do wykonania.

3. **Zapewnić trwałą diagnostykę**
   - Dodać ograniczony do ostatnich 2000 wpisów dziennik zdarzeń jobów w SQLite, bez kluczy API, treści kart i pełnych payloadów.
   - Rejestrować: utworzenie, wysłanie partii, zatwierdzenie partii, automatyczne odzyskanie, błąd dostawcy, zakończenie, reset i odwołanie do nieistniejącego `jobId`.
   - Zdarzenia resetu zachowywać również po wyczyszczeniu kolekcji, aby można było wyjaśnić późniejsze `JOB_NOT_FOUND`.
   - Te same zdarzenia emitować jako ustrukturyzowane logi serwera z `jobId`, identyfikatorem instancji, statusem, kursorem i rozmiarem partii.

4. **Uodpornić odświeżanie Ustawień**
   - Pozostawić status wyłącznie w Ustawieniach, zgodnie z wyborem użytkownika.
   - Zastąpić nakładający się `setInterval` pojedynczym cyklem pollingu: co 2 sekundy przy widocznym widoku i aktywnym jobie.
   - Wstrzymywać polling w ukrytej karcie; odświeżać natychmiast po `focus`, `visibilitychange` i odzyskaniu połączenia.
   - Przy błędach sieci stosować backoff 2/5/10/30 sekund bez zatrzymywania backendowego joba.
   - Przy `TRAINING_REFRESH_JOB_NOT_FOUND` przerwać polling starego ID, pobrać autorytatywny `/api/training/status`, przełączyć się na aktualny job albo pokazać komunikat diagnostyczny bez zapętlania 404.
   - Po statusie terminalnym pobrać pełny stan kolejek i pul ćwiczeń.
   - Dodać informację: „Możesz opuścić tę stronę; analiza działa na serwerze i wróci po restarcie”, wraz z ostrzeżeniem o możliwym ponowieniu jednej przerwanej partii.

## Interfejsy

- Zachować istniejące endpointy i statusy jobów.
- Rozszerzyć publiczny obiekt joba o:
  - `recoveryCount`,
  - `lastRecoveredAt`,
  - `inFlightSpotCount`.
- `progress` nadal liczyć jako `cursor / candidateCount`, ale po zmianie będzie reprezentował wyłącznie trwale zapisany postęp.
- `attemptedRequests` może przekroczyć `estimatedRequests` po odzyskaniu; UI opisze je jako faktyczne próby, nie planowaną liczbę partii.

## Testy i kryteria akceptacji

- Test serwisu: restart z zapisaną `inFlight` ponawia tę samą partię i kończy job bez brakujących spotów.
- Test atomowości: restart po zatwierdzeniu partii nie wysyła jej ponownie i nie tworzy podwójnych kluczy.
- Test błędu dostawcy: job przechodzi do `failed` bez automatycznej pętli retry, a ręczne wznowienie kontynuuje kolejne partie.
- Test zatrzymania: `stop_requested` podczas restartu kończy jako `stopped`.
- Test API/repozytorium: job i dziennik zdarzeń przeżywają ponowne utworzenie serwisu na tej samej bazie; reset zostawia ślad diagnostyczny.
- Test UI: odmontowanie i ponowne wejście w Ustawienia odtwarza postęp, 404 przełącza się na status serwera, polling nie nakłada żądań i respektuje widoczność/backoff.
- Na końcu uruchomić pełne testy, lint i build; ręczny smoke test wykonać na jednej małej partii z F5, przejściem do innego widoku oraz kontrolowanym restartem backendu.

## Założenia

- Jedno potwierdzenie obejmuje cały job i jego automatyczne odzyskiwanie.
- Przeglądarka może być zamknięta; backend musi działać. Gdy backend jest wyłączony, praca zostaje trwale zapisana i ruszy przy następnym uruchomieniu.
- Nie dodajemy Redis, zewnętrznej kolejki ani osobnego procesu workera — lokalny SQLite pozostaje źródłem prawdy.
