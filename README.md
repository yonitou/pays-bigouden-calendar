# Calendrier Pays Bigouden

Génère automatiquement un calendrier iCal (.ics) des événements du [Pays Bigouden](https://www.destination-paysbigouden.com/a-voir-a-faire/agenda).

## Utilisation

### S'abonner au calendrier sur iPhone

1. Va dans **Réglages** > **Calendrier** > **Comptes** > **Ajouter un compte**
2. Sélectionne **Autre** > **Ajouter un calendrier avec abonnement**
3. Entre l'URL du calendrier :
   ```
   https://raw.githubusercontent.com/yonitou/pays-bigouden-calendar/main/dist/pays-bigouden.ics
   ```
4. Valide et configure les options (nom, couleur, alertes...)

Le calendrier sera mis à jour automatiquement (1x/jour par iOS).

### S'abonner sur Mac

1. Ouvre l'app **Calendrier**
2. Menu **Fichier** > **Nouvel abonnement à un calendrier...**
3. Entre l'URL ci-dessus

### S'abonner sur Google Calendar

1. Va sur [Google Calendar](https://calendar.google.com)
2. Clique sur **+** à côté de "Autres agendas"
3. Sélectionne **À partir de l'URL**
4. Colle l'URL ci-dessus

## Mise à jour automatique

Le calendrier est mis à jour automatiquement tous les jours à 6h (UTC) via GitHub Actions.

Tu peux aussi déclencher une mise à jour manuelle depuis l'onglet "Actions" du repo.

## Développement local

```bash
# Installation
npm install

# Générer le calendrier
npm run generate
```

Le fichier sera généré dans `dist/pays-bigouden.ics`.

## Fonctionnalités

- Titre, date et heure de chaque événement
- Lieu avec adresse complète
- Description avec numéro de téléphone si disponible
- Lien vers la fiche détaillée de l'événement
- Coordonnées GPS (affichage sur carte)
- Catégorie d'événement (concert, marché, etc.)

## Note

Ce projet scrape la page agenda de destination-paysbigouden.com. Il n'utilise pas d'API officielle. Si le site change sa structure, le script devra être adapté.