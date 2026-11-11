# prebuilt/ccs-web

The production build of the Angular site (`npx ng build --configuration production`, `dist/Ccs.Web/browser`),
kept in the repository so a Windows server can build a release with only the .NET 10 SDK (see `Build-Release.ps1`).
Rebuilt and committed together with every change to `src/Ccs.Web`. `BUILD.txt` holds the build stamp used in the release name.
