# Zadania: podsumowanie sesji Cash i turnieju

Ścieżka krytyczna: `1 → 2 → 3 i 4 → 5 → 6 i 7 → 8 → 9`.

1. **Kontrakt metryk i fixture’y**
   - Zdefiniować per-hand `heroStats`, `bigBlind`, liczniki okazji i wykonań.
   - Dodać testowe logi dla blindów, ante, straddle, `AUTOBB`, `RETURN`, all-inów, rebuyów i multi-boardów.

2. **Normalizacja akcji CoinPoker**
   - Zbudować ledger wkładów wszystkich graczy per ulica.
   - Rozróżniać all-in call od betu/raise’a; obsłużyć `raises X to Y`, forced posts oraz `FIRST/SECOND/THIRD` ulice.
   - Naprawić inwestycję i `netProfit` dla AUTOBB/straddle.

3. **Metryki preflop**
   - Poprawnie wyliczyć VPIP, PFR, 3-bet, fold to 3-bet, 4-bet oraz RFI/steal dla CO, BTN i SB.
   - Straddle liczy się do VPIP, ale wyklucza okazję do RFI/steal.

4. **Metryki postflop i showdown**
   - Wyliczyć AF, AFq łącznie oraz dla flop/turn/river.
   - Wyliczyć c-bet, c-bet SRP i fold to c-bet dla wszystkich kwalifikujących się pul, także multiway.
   - Zachować `SUMMARY` jako źródło prawdy dla WTSD i W$SD.

5. **Wspólny agregator sesji**
   - Dodać `calculateSessionMetrics(hands, gameType)`.
   - Cash: BB/100; turniej: żetony/100; zawsze pokazać też wynik netto i Hands.
   - Zwracać `—` bez okazji, `∞` tylko dla AF z agresją i zerową liczbą calli.
   - Podłączyć istniejący „Mój profil” do tego samego silnika.

6. **Klasyfikator stylu**
   - Dodać deterministyczny „najbliższy profil statystyczny”: TAG, LAG, Nit/Rock, loose-passive, tight-passive, maniak, weak-tight, reg/zbalansowany, recreational/niestandardowy lub mieszany.
   - Progi pewności: `<30` rąk — brak klasyfikacji; `30–99` — wstępny; `≥100` — profil statystyczny.
   - Dodać niezależne badge’e short-stack i push-fold.

7. **Komponent podsumowania**
   - Zbudować wspólny `SessionSummary` z trzema sekcjami: Preflop, Postflop, Wynik.
   - Dodać dostępne tooltipy: definicja, wzór oraz licznik/mianownik.
   - Pokazać profil gry, Hands, wynik netto i wynik/100; AFq oraz RFI w rozbiciach.

8. **Integracja widoków**
   - Umieścić podsumowanie nad wykresem w Cash i Turniejach, tylko dla wybranej sesji.
   - Zachować kolory Cash/turniej oraz obecne widoki kolekcji „Z analizą” i „Zapisane ręce” bez panelu sesji.
   - Nie zmieniać granic sesji: Cash = stół + data, turniej = ID + data.

9. **Walidacja końcowa**
   - Testy parsera, agregatora, klasyfikatora i regresje istniejących statystyk.
   - `npm test`, ESLint zmienionych plików, build i ręczny smoke panelu Cash/Turniej na desktopie oraz mobile.
   - Bez wywołań AI i bez zmian historii analiz/zapisanych rąk.
