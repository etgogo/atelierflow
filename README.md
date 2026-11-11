# AtelierFlow — prototype de gestion d’atelier

> **État actuel : prototype local.** Une branche de travail contient une première base SQL Supabase en cours de revue, mais l’application publiée n’est pas encore connectée à cette base.

Application web en français pour suivre les dossiers d’un atelier mécanique : véhicules, clients, planning, ordres de travail, pièces remplacées, anomalies et devis complémentaires.

## Lancer le prototype

Téléchargez/clônez le dépôt puis ouvrez `index.html` dans un navigateur. Vous pouvez aussi lancer un serveur local dans ce dossier :

```bash
python3 -m http.server 8000
```

Puis ouvrez `http://localhost:8000`.

## Fonctions de cette version 2.0

- Tableau de bord et compteurs calculés à partir des dossiers.
- Création de fiches client/véhicule et recherche dans la liste.
- Vues Véhicules, Ordres de travail, Devis et Planning.
- Mise à jour du statut, des tâches, des travaux réalisés et des pièces remplacées.
- Ajout de devis complémentaires, montant et décision enregistrée (en attente, accepté, refusé).
- Validation « prêt à récupérer » et préparation d’un message SMS.
- Les données sont stockées dans le `localStorage` du navigateur sur cet appareil.

## État de la préparation Supabase

Les migrations de la branche `feature/supabase-database-foundation` sont des brouillons de développement. Elles doivent encore être exécutées sur une base Supabase vierge, vérifiées avec des comptes de garages distincts et testées avant toute mise en production. L’interface actuelle utilise toujours `localStorage`.

## Limites importantes du prototype

- Il n’y a pas encore de compte utilisateur ni de base de données en ligne : les données ne sont pas partagées entre appareils et peuvent être effacées par le navigateur.
- Les changements d’état d’un devis sont des saisies internes de démonstration ; ils ne recueillent pas un accord client à distance.
- L’application ouvre le composeur SMS avec le message prérempli. Elle n’envoie pas le SMS automatiquement et ne confirme pas son envoi.
- Les dossiers de démonstration sont fictifs. Avant une utilisation réelle, supprimez-les et mettez en place sauvegarde, accès sécurisés et gestion des données clients.
