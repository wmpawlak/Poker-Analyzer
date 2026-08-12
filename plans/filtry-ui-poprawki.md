# Podział na równoległe strumienie: UI i cache AI

## Wspólny kontrakt

Cache/API udostępni parametry zapytań `sessionAnalysis=all|has|none` i `handAnalysis=all|has` dla miesięcy, sesji i rąk sesji. Podsumowanie sesji zwróci też `sessionAnalysisStatus` (`current|stale|missing`) oraz `analyzedHandsCount`. UI opiera się wyłącznie na tym kontrakcie, bez znajomości zawartości cache’u.

## Część 1 — UI (można realizować od razu)

- Zastąpić tryb „Z analizą” dwoma spójnymi filtrami w widoku sesji: „Raport sesji” i „Analiza rozdań”; „Zapisane” pozostaje osobną kolekcją.
- Oba filtry przekazywać w zapytaniach do listy miesięcy, sesji i rąk; aktywne wartości działają jako przecięcie warunków.
- W akordeonach pokazywać liczbę analizowanych rąk i wizualne oznaczenie raportu sesji, w tym ostrzeżenie dla raportu nieaktualnego.
- Dodać zwijany panel „Analiza AI sesji”. Przy otwarciu pobiera historię raportów sesji, pokazuje ładowanie lub błąd; przy zamknięciu zwalnia dane raportu z Redux.
- Przenieść listę rąk do naturalnego przepływu głównego scrolla zakładki: usunąć wewnętrzny scrollbar i stałą wysokość, zostawić dociąganie kolejnych stron przez sentinel na dole listy.
- Pokryć testami stan filtrów, widoczność kontrolek, parametry zapytań, akordeon lazy-load oraz ładowanie kolejnej strony rąk przy przewinięciu głównego obszaru.

## Część 2 — cache, API i dane (kodować równolegle, wdrożyć po zakończeniu analiz)

- Przenieść ocenę „ma/nie ma raportu” i „ma analizowane ręce” na serwer, bazując na wspólnym cache’u AI; raport nieaktualny nadal spełnia warunek „ma analizę”.
- Rozszerzyć endpointy indeksu miesięcy, sesji i rąk o wspólny kontrakt filtrów oraz lekkie metadane sesji, bez przesyłania pełnej treści raportów.
- Zmienić synchronizację startową: pełne raporty sesji nie trafiają do pamięci klienta. Istniejące lokalne raporty sesji są jednorazowo migrowane do wspólnego cache’u.
- Dodać endpoint pobrania historii raportów pojedynczej sesji oraz zapis pojedynczego nowego raportu. Utworzenie raportu od razu zapisuje go na serwerze i odświeża metadane list.
- Zachować automatyczne pobranie i otwarcie panelu, gdy użytkownik przechodzi do konkretnego raportu sesji z historii analiz.
- Pokryć testami filtrowanie po obu warunkach, ich przecięcie, paginację i sortowanie, migrację lokalnych raportów oraz odczyt/zapis historii pojedynczej sesji.

## Integracja i kolejność

- Oba strumienie mogą powstawać równolegle na osobnych gałęziach, używając powyższego kontraktu.
- Scal najpierw część cache/API, potem UI; dzięki temu UI nie trafi na nieistniejące parametry i metadane.
- Gdy w tle działają analizy, można bezpiecznie robić część UI. Część cache można pisać i testować, ale nie należy wtedy uruchamiać migracji, restartować serwera ani wdrażać zmian synchronizacji — to nastąpi dopiero po opróżnieniu kolejki analiz.
