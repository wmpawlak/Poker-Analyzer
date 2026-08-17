# Kontrola wersji — zadania dla Luny

Każde zadanie wykonuj kolejno, nie zmieniaj zakresu innych modułów i po zakończeniu uruchamiaj wskazane testy.

1. **Migracja bazy do wersji zakresów**
   - Dodaj model: setup preflop ma aktywną wersję, a wersje mają `id`, nazwę, dane 169 rąk, daty i rewizję.
   - Zmigruj istniejący zapis `preflop-matrix` do wersji nazwanej `Open-raise`.
   - Gdy baza jest pusta, utwórz wersję `Open-raise` z wartościami Fold.
   - Test: migracja nie gubi istniejących wartości rąk.

2. **Odczyt listy i aktywnej wersji przez API**
   - Dodaj endpoint zwracający listę wersji oraz aktywną wersję.
   - Dodaj odczyt pełnych danych konkretnej wersji.
   - Wybór aktywnej wersji zapisuj w bazie, aby po odświeżeniu wracała ta sama.
   - Test: po zmianie aktywnej wersji kolejne odczytanie zwraca właściwą wersję.

3. **Zapis i zmiana nazwy wersji**
   - „Zapisz” nadpisuje tylko aktywną wersję.
   - Dodaj API do zmiany nazwy wersji.
   - Nazwa nie może być pusta.
   - Test: zapis jednej wersji nie zmienia danych innej; zmiana nazwy jest trwała.

4. **Kopiowanie i usuwanie wersji**
   - Dodaj kopiowanie aktywnej wersji jako `Kopia — <nazwa>`.
   - Kopia staje się aktywna.
   - Dodaj usuwanie z blokadą usunięcia ostatniej wersji.
   - Test: kopia ma identyczne dane, ale niezależne ID; usunięcie nie narusza pozostałych wersji.

5. **Dropdown i ładowanie wersji w UI**
   - Dodaj dropdown wersji w nagłówku zakresów.
   - Po zmianie wybieraj nową aktywną wersję i ładuj jej macierz.
   - Po odświeżeniu aplikacji pokaż aktywną wersję z bazy.
   - Test UI: przełączenie dropdownu zmienia ręce i nagłówek.

6. **Nazwa, kopiowanie i usuwanie w UI**
   - Nazwa aktywnej wersji jest edytowalnym nagłówkiem; zapis następuje po Enter lub utracie fokusu.
   - Dodaj przyciski „Kopiuj” i „Usuń”.
   - Usuwanie wymaga potwierdzenia; przy jednej wersji przycisk jest niedostępny.
   - Test UI: zmiana nazwy, utworzenie kopii i bezpieczne usunięcie.

7. **Legenda na stronie**
   - Nad matrycą dodaj kompaktową legendę wyłącznie kolorów: Fold — zielony, Call — żółty, Raise — czerwony.
   - Nie dodawaj do legendy pozycji UTG/HJ/BTN/SB.
   - Nagłówek strony pokazuje nazwę aktywnej wersji.

8. **Eksport obrazu**
   - Eksport PNG przyjmuje nazwę aktywnej wersji jako tytuł.
   - Dodaj tę samą kompaktową legendę kolorów u góry.
   - Zmień tło obrazu na białe; zachowaj czytelne obramowania komórek.
   - Test: generator obrazu zawiera nazwę wersji, legendę i białe tło.

9. **Końcowa weryfikacja**
   - Uruchom testy API i UI zakresów, `npm run lint`, `npm run build`.
   - Sprawdź ręcznie: utworzenie kopii → zmiana kilku rąk → zapis → odświeżenie → powrót do właściwej wersji.
