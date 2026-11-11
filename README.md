# AtelierFlow — gestion d’atelier

Application web en français pour suivre les clients, véhicules, ordres de travail, devis et entrées planifiées d’un atelier mécanique.

## État de la branche de développement

La branche `feature/supabase-database-foundation` contient désormais une première intégration de Supabase :
- création de compte et connexion par e-mail / mot de passe ;
- création initiale d’un espace garage via la fonction sécurisée `create_garage_with_admin` ;
- chargement des clients, véhicules, ordres de travail et devis depuis Supabase ;
- création des dossiers client / véhicule / ordre de travail ;
- mise à jour des notes et du statut de l’ordre de travail ;
- création des devis complémentaires ;
- session persistante et déconnexion ;
- séparation des données par garage via les politiques RLS PostgreSQL.

La clé incluse dans `config.js` est une clé publique *publishable* prévue pour être utilisée dans un navigateur. Aucune clé service-role ou autre secret serveur ne doit être ajoutée au dépôt.

## Configuration Supabase

Le projet de développement est configuré dans `config.js`. Pour un autre projet, remplacez l’URL et la clé publique par celles de ce projet. Les migrations SQL numérotées doivent être appliquées dans l’ordre sur une base vierge.

L’inscription peut nécessiter une confirmation par e-mail selon les paramètres Auth du projet. Dans ce cas, l’utilisateur doit confirmer son adresse avant de se connecter et de créer son garage.

## Limites avant production

Cette intégration est une première version fonctionnelle du parcours principal, mais elle n’est pas encore certifiée prête pour une utilisation réelle :
- tests navigateur et tests de bout en bout à réaliser avec deux comptes et deux garages distincts ;
- tests de sécurité RLS et de récupération de compte à compléter ;
- la clôture d’un ordre de travail reste volontairement désactivée dans l’interface tant que les kilométrages d’entrée et de sortie ne sont pas saisis ;
- le planning est affiché à partir des dates prévues des ordres de travail ; la gestion complète des rendez-vous et des mécaniciens reste à développer ;
- les données de démonstration locales ne sont pas importées automatiquement dans Supabase ;
- sauvegardes, politique de conservation des données et conformité RGPD à valider avant production.

## Publication

La version actuellement publiée sur GitHub Pages n’est pas modifiée par cette branche. Ne fusionnez ni ne publiez cette branche avant les tests de validation et une revue de sécurité.
