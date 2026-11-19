# Plan usadzenia gości

Aplikacja w czystym HTML/CSS/JS – bez instalowania czegokolwiek.

## Struktura

```
index.html      szkielet strony
config.js       adres bazy do synchronizacji (do uzupełnienia)
css/style.css   wygląd
js/app.js       logika aplikacji (stoły, goście, pary, przeciąganie)
js/sync.js      synchronizacja między urządzeniami
```

## Uruchomienie lokalnie (VS Code)

Otwórz folder w VS Code i uruchom `index.html` (np. rozszerzeniem **Live Server**) albo po prostu dwukliknij plik.

## Publikacja na GitHub Pages

1. Utwórz repozytorium na GitHubie i wgraj wszystkie pliki z tego folderu.
2. **Settings → Pages → Source: Deploy from a branch**, wybierz gałąź `main` i folder `/ (root)`.
3. Po chwili strona będzie dostępna pod adresem `https://TWOJ-LOGIN.github.io/NAZWA-REPO/`.

## Synchronizacja między urządzeniami (Firebase, darmowy plan)

GitHub Pages nie umie zapisywać danych, dlatego plan trzymamy w darmowej bazie Firebase.

1. Wejdź na <https://console.firebase.google.com> i utwórz projekt (Google Analytics możesz wyłączyć).
2. **Build → Realtime Database → Create database**, wybierz lokalizację w Europie, start w trybie testowym.
3. Zakładka **Rules** – wklej poniższe reguły i kliknij **Publish**:

   ```json
   {
     "rules": {
       "plans": {
         "$code": {
           ".read": "$code.length >= 12",
           ".write": "$code.length >= 12"
         }
       }
     }
   }
   ```

   Dzięki temu nikt nie może wylistować cudzych planów – dostęp ma tylko ten, kto zna długi kod planu.
4. Skopiuj adres bazy (widać go nad danymi, wygląda jak `https://....firebasedatabase.app`) do pliku `config.js`:

   ```js
   window.WESELE_CONFIG = {
     databaseURL: 'https://twoja-baza-default-rtdb.europe-west1.firebasedatabase.app'
   };
   ```
5. Wgraj zmianę na GitHuba. W aplikacji kliknij **☁ Synchronizacja → Wygeneruj kod → Połącz**.
6. Na telefonie i drugim komputerze otwórz tę samą stronę, kliknij **☁ Synchronizacja**, wpisz ten sam kod i **Połącz**.

Zmiany zapisują się automatycznie, a inne urządzenia pobierają je co kilka sekund.
Kod jest tajny – kto go zna, może edytować plan, więc nie publikuj go.

## Kopia zapasowa

Przyciski **Zapisz do pliku** / **Wczytaj z pliku** eksportują i importują cały plan jako JSON.
**Eksport CSV** tworzy listę gości z numerami stołów i miejsc.
