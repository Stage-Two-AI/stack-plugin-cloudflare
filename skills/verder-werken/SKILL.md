---
name: verder-werken
description: De vaste route voor een wijziging aan deze app - branch maken, bouwen, testen, pull request openen met preview-link. Gebruik dit bij elk verzoek om iets toe te voegen, te wijzigen of te repareren aan deze applicatie, ook als het een kleinigheid lijkt, ook als er een tabel, kolom of policy bij komt (databasewijziging), en ook als de gebruiker tijdens het bouwen wil meekijken.
---

Deze route staat uitgeschreven in `docs/routes/verder-werken.md`. Lees dat bestand nu in
zijn geheel en loop de stappen in volgorde af.

Hier staat bewust geen kopie van de tekst. De route is voor elke agent dezelfde, en
`docs/routes/` is de enige plek waar hij staat, zodat er nooit twee versies zijn die
uit elkaar lopen. Deze skill is alleen de aansluiting voor Claude Code.

Twee dingen die bij deze route horen en die de route zelf ook noemt:

- **Raakt de wijziging de database** (een tabel, kolom, index of policy), lees dan ook
  `docs/routes/databasewijziging.md` in zijn geheel en volg die stappen. De hook van de
  plugin herinnert je eraan zodra je in `supabase/migrations/` schrijft.
- **Meekijken tijdens het bouwen** gaat in de Claude-app via de preview: die start de app
  op deze computer volgens `.claude/launch.json`, tegen de testdatabase en nooit tegen
  productie. Start geen dev-server in Bash. Opleveren blijft altijd de pull request met
  de Cloudflare-preview (de workflow Preview uitrollen zet de link in de PR).
