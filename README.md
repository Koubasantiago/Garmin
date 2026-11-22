# Běžecký kompas 🏃

Česká soukromá aplikace pro analýzu běžeckých aktivit z Garminu. Navržená pro iPhone a nasazení přes GitHub Pages.

## Novinky verze 1.2

- **Pět tepových zón Z1–Z5**: doba v zónách pro vybrané období i jednotlivý běh; volitelné procentní hranice a maximum tepu v nastavení. Výchozí maximum 185 bpm je **pouze ukázková hodnota**, nikoliv individuální zdravotní údaj. Čas je vyhodnocen výhradně z platných průběžných vzorků.
- **Kadence v krocích za minutu (SPM)**: trend posledních 12 běhů, průměr každého běhu, průběh v grafu v detailu; FIT/TCX/GPX a volitelné CSV i ruční zadání. FIT/TCX hodnoty celých krokových cyklů se převádějí na dva kroky, pokud je nutné.
- Po aktualizaci aplikace na stejné URL zůstanou záznamy v IndexedDB zachovány; pro jistotu je vhodné předem exportovat zálohu JSON. Původně importované běhy bez kadence ji nezískají automaticky – je nutné znovu importovat původní FIT/TCX, pokud souhrn nebo průběhová data chybějí.

## Co už funguje

- Nahrání jedné nebo více běžeckých aktivit **FIT, TCX, GPX**, nebo souhrnného Garmin **CSV**; lze také importovat vlastní zálohu JSON.
- **FIT dekódování:** oficiální JavaScript SDK Garmin `@garmin/fitsdk`.
- Graf naběhaných kilometrů za posledních osm týdnů.
- Graf vývoje průměrného tempa posledních 12 běhů.
- **Srovnání tepové frekvence při podobném tempu** – samostatný graf z běhů s použitelným tepem, automaticky porovnává běhy s tempem přibližně ±4,5 %, podobnou délkou (75–133 % referenční vzdálenosti) a, pokud je dostupné, podobným převýšením (rozdíl do 8 m/km). Zobrazuje změnu bpm a opatrnou interpretaci. Když vhodné párování chybí, ukáže pouze trend všech běhů bez závěru o kondici.
- Výběr souhrnného období 7 / 30 / 90 dní / vše.
- Detail běhu: tempo, tep, čas, stoupání; průběh tepu a tempa, orientační mezičasy a náčrt GPS trasy (pokud jsou dostupné záznamy).
- Týdenní cíl na kilometry s průběhem od pondělí.
- Automatické stručné postřehy o pravidelnosti, změnách týdenního objemu a vývoji tempa. Nejde o diagnostiku ani o specializovaný algoritmus tréninkové zátěže Garmin.
- Ruční zadání běhu, odstranění aktivity, import/export vlastní JSON zálohy.
- Data jsou ukládána **v prohlížeči na tvém zařízení** (IndexedDB) a nejsou odesílána na náš server. GitHub Pages poskytuje pouze statické soubory aplikace.
- Při úplně prvním spuštění jsou vidět **výslovně označená ukázková data**. Po importu skutečných aktivit zmizí.

## Spuštění na GitHub Pages – krok za krokem

1. Rozbal archiv `garmin-beh-app-zdrojaky.zip` na počítači.
2. Na [github.com/new](https://github.com/new) vytvoř nové veřejné úložiště, např. `bezecky-kompas`.
3. Otevři nové úložiště a vyber **Add file → Upload files**.
4. Nahraj **obsah** rozbalené složky včetně souborů `index.html`, `package.json`, `vite.config.js`, složek `src`, `public` a skryté složky `.github`. GitHub Web může ignorovat skryté složky při přetažení; pokud se workflow nezobrazí, vytvoř ručně soubor `.github/workflows/deploy.yml` s obsahem z archivu, nebo použij Git na počítači.
5. Ulož soubory tlačítkem **Commit changes**. Pokud se výchozí větev nejmenuje `main`, přejmenuj ji na `main`, nebo uprav větev v `.github/workflows/deploy.yml`.
6. V úložišti jdi do **Settings → Pages → Build and deployment → Source → GitHub Actions**.
7. Otevři záložku **Actions** a spusť workflow „Nasazení aplikace na GitHub Pages“, pokud se nespustilo samo.
8. Po úspěšném dokončení otevři adresu `https://TVUJ-UCET.github.io/bezecky-kompas/` (dle skutečného názvu úložiště).

Použitá automatická akce instaluje závislosti, sestaví produkční verzi příkazem `npm run build` a publikuje obsah složky `dist`. Relativní cesty fungují i pro jiný název úložiště.

### Odkaz na plochu iPhonu

1. Otevři adresu aplikace v **Safari** na iPhonu.
2. Zvol **Sdílet → Přidat na plochu**.
3. Pojmenuj ji například „Běžecký kompas“ a potvrď.

## Jak získat data z Garminu

V **Garmin Connect na webu** otevři konkrétní běžeckou aktivitu a nabídku pro export; vyber **Export Original / Původní soubor (FIT)**, případně **Export to TCX / GPX**. FIT bývá nejlepší volba pro průběh tepu a další sportovní hodnoty. Pro hromadný souhrnný export lze použít tabulku CSV s rozpoznanými sloupci datum, vzdálenost, čas a případně průměrný tep; formáty CSV se mohou lišit.

Na iPhonu ulož export do aplikace **Soubory**, otevři Běžecký kompas, stiskni **Nahrát běh z Garminu** a vyber soubor. Je možné vybrat více souborů najednou.

**Poznámka k formátům:** GPX nemusí obsahovat tep a některé FIT/TCX soubory neobsahují všechny metriky. V takovém případě se zobrazí pouze údaje skutečně přítomné v souboru. Aplikace neumí sama načíst Garmin Connect účet nebo synchronizovat hodinky bez exportu, protože neobsahuje autentizaci ani schválenou integraci Garmin API.

## Spuštění lokálně

Požadavky: Node.js 20+.

```bash
npm install
npm run dev
```

V prohlížeči otevři URL, kterou vypíše Vite (obvykle `http://localhost:5173`). Produkční sestavení vytvoříš příkazem `npm run build`.

## Soukromí a zálohování

Data se ukládají do IndexedDB pro konkrétní **prohlížeč, zařízení a webovou adresu**. Nejsou automaticky synchronizována mezi zařízeními. Po smazání dat webu nebo v anonymním režimu se mohou ztratit. Pravidelně exportuj **Zálohu JSON** a bezpečně ji uschovej. Zálohu lze opět nahrát přes tlačítko importu.

## Omezení první verze

- Zatím neprobíhá automatická synchronizace s Garmin Connect.
- Výpočty tempa/měření GPS vycházejí z dostupného exportu; pauzy a nepřesnosti mohou měnit výsledek.
- Hodnocení je jednoduché a orientační: nezahrnuje HRV, Training Readiness, VO2 max ani skutečnou personalizovanou tréninkovou diagnostiku.
- Vyrenderování ukázkové trasy je pouze schematické, bez mapového podkladu.
- Aplikace není náhradou za lékaře ani profesionálního trenéra.

## Další verze – návrhy

- Nastavitelné tepové zóny podle osobních hodnot nebo Garmin exportu.
- Přesnější srovnání **stejných tras** a tempa při podobném tepu se zohledněním počasí, povrchu a intenzity tréninku.
- Běžecký kalendář, počítání souvislých týdnů a motivace bez nátlaku.
- Trendy ve stoupání, kadenci a rozložení tréninků.
- Volitelné pravidelné upozornění na odpočinek a postupné navyšování zátěže.
- Synchronizace mezi více zařízeními až s uživatelským účtem a bezpečným úložištěm.
