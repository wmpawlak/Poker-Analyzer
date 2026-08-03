# Poprawne WR rąk startowych i filtr Hero WTSD

## Podsumowanie

Sama formuła `wygrane / liczba rąk` jest poprawna, ale audyt wykazał dwa błędy wejściowe: `sawShowdown` dotyczy obecnie całego rozdania zamiast Hero, a jedno rozdanie PLO jest liczone jako `52o`.

## Zmiany

- Ustalać `sawShowdown` wyłącznie na podstawie pokazania lub muckowania kart przez Hero. Poprawi to również WTSD/W$SD w profilu.
- Dodać domyślnie odznaczony checkbox „Went to showdown (Hero)”, dostępny w widoku listy i w modalnej mapie.
- Po zaznaczeniu filtrować jednocześnie mapę i listę oraz przeliczać liczbę rąk, wygrane, przegrane, procent WR, badge i skalę wykresów.
- Łączyć filtr WTSD z istniejącym wyborem Wszystko/Cash/Turnieje.
- Uwzględniać w statystykach startowych wyłącznie rozdania z dokładnie dwiema kartami Hero, wykluczając PLO.
- Zachować definicję `WON`: otrzymanie dowolnej części puli liczy rozdanie jako wygrane, zgodnie ze standardowym W$SD ([PokerTracker](https://www.pokertracker.com/guides/PT3/general/statistical-reference-guide)).

Zmieni się semantyka wewnętrznego pola `hand.sawShowdown`; publiczne API pozostaje bez zmian.

## Testy

- Hero pasuje, a inni dochodzą do showdown → `sawShowdown: false`.
- Hero pokazuje/muckuje karty, również bez standardowej sekcji showdown → `true`.
- Checkbox poprawnie zmienia mianownik, licznik i WR na mapie oraz liście.
- Rozdania czterokartowe nie trafiają do statystyk 169 rąk.
- Na obecnych danych oczekiwane jest 5 197 showdownów Hero zamiast błędnych 15 740.
- Uruchomić testy, build oraz ESLint zmienionych plików przez `npm.cmd`.
