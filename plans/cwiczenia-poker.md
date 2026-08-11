# Moduł ćwiczeń na prawdziwych rozdaniach

## Podsumowanie

Dodać jedną zakładkę „Ćwiczenia” z czterema osobnymi trybami:

1. Selekcja preflop.
2. Gra przeciw 3-betom i reshove’om.
3. C-bet i kolejne baryłki.
4. Decyzje turn/river.

Moduł utworzy lokalny katalog spotów z najnowszej historii NLH, ukryje wynik i przyszłe akcje, a następnie przygotuje cache’owane klucze odpowiedzi przez połączenie lokalnych obliczeń z oceną AI. Aktywna pula każdego trybu będzie zawierała maksymalnie 100 spotów Cash i 100 turniejowych.

## Zadania implementacyjne

1. **Ekstrakcja spotów**
   - Zrekonstruować pozycje wszystkich graczy, stacki, wielkość puli, kwotę do sprawdzenia, pot odds, akcje oraz efektywny stack w BB.
   - Tworzyć stabilne identyfikatory decyzji na podstawie rozdania, ulicy i kolejności akcji.
   - Obsługiwać ante, straddle, auto-BB, all-in, reshove, pule wieloosobowe i zwrot niewyrównanego zakładu.
   - Wykluczyć PLO, Bomb Pot, rebuy oraz spoty z niepełnymi lub niespójnymi danymi.

2. **Reguły czterech ćwiczeń**
   - `preflop_selection`: dobrowolne decyzje fold/call/raise; późniejsza odpowiedź na 3-bet może z tego samego rozdania trafić do ćwiczenia 2.
   - `preflop_vs_reraise`: open przeciw 3-betowi oraz raise przeciw reshove’owi; pytanie pokazuje efektywny stack i pot odds.
   - `cbet_barrels`: okazja do flop c-betu z odpowiedziami check, mały bet do 40% puli lub duży bet powyżej 40%; opcjonalna decyzja turn jest drugim etapem tego samego epizodu.
   - `turn_river`: value bet, bluff, bluff-catcher, check lub fold. Klucz przechowuje także odpowiadającą kategorii akcję.
   - Turn w ćwiczeniu c-bet korzysta z prawdziwego przebiegu rozdania. Interfejs jasno zaznacza, że jest to dalszy ciąg historycznej linii, a nie symulacja konsekwencji odpowiedzi użytkownika.

3. **Trwała kolekcja i historia**
   - Dodać wersjonowany [data/poker-training-v1.json](C:/Users/Wojtek/Desktop/Projekty/Poker-Analyzer/data/poker-training-v1.json) z katalogiem spotów, kluczami AI, sesjami, próbami i stanem skanowania.
   - Zapisy wykonywać atomowo i serializować po stronie serwera.
   - Przechowywać odciski źródłowych rozdań, aby kolejne skany analizowały wyłącznie nowe lub zmienione rekordy.
   - Nowe, poprawnie ocenione spoty zastępują najstarsze w aktywnym limicie; stare klucze i próby pozostają w archiwum.
   - Usunięte lub zmienione rozdanie nie może być dalej zadawane, ale jego historyczne próby pozostają widoczne.

4. **Generowanie kluczy odpowiedzi**
   - AI otrzymuje wyłącznie stan przed decyzją: bez wyniku, kart rywali, przyszłych kart, przyszłych akcji i faktycznej decyzji Hero.
   - Lokalne reguły są źródłem pot odds, stacków, legalnych odpowiedzi i klasyfikacji sizingu; AI odpowiada tylko za ocenę strategiczną.
   - Klucz zawiera preferowaną odpowiedź, dopuszczalne alternatywy, poziom pewności, uzasadnienie, istotne blockery/equity, przewidywany zakres oraz sugerowany sizing.
   - Tylko klucze o wysokiej pewności i zgodne z lokalnymi faktami trafiają do automatycznie ocenianej puli. Pozostałe trafiają do „Ponownej analizy”.
   - Generować maksymalnie 20 kluczy w jednym potencjalnie płatnym żądaniu, zapisywać poprawne partie od razu i nie ponawiać błędów automatycznie.
   - Odświeżanie działa jako zadanie w tle, korzysta z aktualnie wybranego modelu, pokazuje przewidywaną liczbę żądań i wymaga potwierdzenia. Można je zatrzymać po bieżącej partii i później wznowić.

5. **API i stan aplikacji**
   - Dodać typy `ExerciseType`, `TrainingSpot`, `AnswerKey`, `TrainingAttempt`, `TrainingSession` i `RefreshJob`.
   - Endpointy `/api/training/*` mają obsługiwać status kolekcji, rozpoczęcie/zatrzymanie/wznowienie odświeżania, tworzenie lub wznawianie sesji, pobranie następnego pytania, zapis odpowiedzi oraz historię/statystyki.
   - Odpowiedź na pytanie jest zapisywana atomowo i dopiero wtedy API zwraca klucz, ocenę oraz faktyczną historyczną akcję.
   - Wynik finansowy, showdown i dalsza część rozdania pozostają ukryte. Pełny Replayer można otworzyć osobnym, świadomym przyciskiem.

6. **Zakładka „Ćwiczenia”**
   - Dodać wybór jednego z czterech trybów, filtry Cash/Turnieje i rozmiar sesji: 10, 20, 50, 100 lub cała dostępna pula; domyślnie 20.
   - Pokazywać karty Hero, pozycję, stacki, wcześniejsze akcje, aktualną pulę, board do bieżącej ulicy oraz informacje właściwe dla ćwiczenia.
   - Użytkownik wybiera tylko odpowiedź; zakresy, powody calla, blockery i argumenty value/bluff są pokazywane w informacji zwrotnej.
   - Punktacja: „poprawna” dla preferowanej odpowiedzi, „dopuszczalna” dla sensownej alternatywy i „błąd” dla pozostałych.
   - Losować najpierw niewidziane spoty, później ważyć błędy 4×, odpowiedzi dopuszczalne 2× i poprawne 1×, bez natychmiastowych powtórek.
   - Zapisywać aktywną sesję po każdej odpowiedzi, aby można ją było wznowić po odświeżeniu strony.
   - Pokazać podsumowanie sesji, wyniki według pozycji/stacka/trybu oraz kolejkę „Ponowna analiza”.

7. **Ustawienia kolekcji**
   - Rozszerzyć ustawienia o ostatni skan, rewizję datasetu, liczbę nowych kandydatów, gotowe pule 100 Cash + 100 MTT na tryb, kolejkę AI, odrzucone spoty i użyty model.
   - Przycisk „Odśwież kolekcję” najpierw wykonuje lokalny skan, następnie pokazuje kosztowy zakres pracy AI i prosi o potwierdzenie.
   - Zmiana domyślnego modelu nie przelicza starych kluczy; każdy klucz zachowuje model, wersję kontraktu i datę utworzenia.

## Testy i kryteria odbioru

- Testy ekstraktora obejmą pozycje, ante, auto-BB, straddle, 3-bet/4-bet/reshove, all-in, pot odds, efektywny stack, multiway, sizingi i brak wycieku przyszłych informacji.
- Testy repozytorium i API sprawdzą atomowy zapis, idempotentny skan, wykrywanie nowych/zmienionych rozdań, limity 100+100, archiwizację, wznawianie sesji i poprawną punktację.
- Testy AI użyją mocków: walidacja identyfikatorów, legalnych odpowiedzi, wysokiej pewności, częściowo błędnej partii, zatrzymania zadania i braku automatycznego płatnego retry.
- Testy UI obejmą nawigację, wybór ćwiczenia i formatu, pytanie bez wyniku, sekwencję flop–turn, informację zwrotną, historię oraz panel odświeżania.
- Kontrole będą uruchamiane po ukończeniu ekstraktora/repozytorium, po API oraz na końcu jako pełne `npm test`, `npm run lint` i `npm run build`; automatyczne testy nie wykonują prawdziwych wywołań AI.
- Ręczny smoke test użyje jednej małej partii i potwierdzi, że odświeżenie dopisuje nowe rozdania bez ponownej oceny starych.

## Założenia

- Ocena jest rekomendacją trenerską, a nie wynikiem solvera GTO.
- Kolekcja obejmuje wyłącznie prawdziwe rozdania NLH z lokalnego kanonicznego datasetu.
- Cele 200 decyzji dla ćwiczenia 1 i 100 dla pozostałych będą widoczne jako cele postępu, ale użytkownik może wykonywać krótsze sesje.
- Ponieważ wybrano odpowiedź „tylko wybór akcji”, wymagane w pierwotnym opisie powody calla, zakresy i blockery są częścią klucza oraz feedbacku, a nie obowiązkowym polem użytkownika.
- Istniejące, niezwiązane zmiany w repozytorium pozostają nienaruszone.
