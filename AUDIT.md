# Jilact — audit du cahier des charges

**Base examinée :** `sp_cifications_techniques_et_fonctionnelles_application_jilact.txt` (v1.0.0-Core, octobre 2026), les quatre visuels fournis et l’implémentation web disponible dans ce dossier.  
**Conclusion :** la vision produit et l’identité visuelle sont cohérentes. Le projet dispose maintenant d’un prototype PWA avec un socle de connexion Supabase et un flux YouTube préparé ; la mise en production dépend encore de comptes cloud, de vérifications réelles et de décisions produit.

## Points solides

- Les quatre modules structurent clairement le parcours : compte, tableau de bord, studio de programmation et diagnostic.
- Les besoins opérationnels sont pertinents : multi-profils, file de publication, pause/reprise, rappels nécessitant une validation et expiration.
- La direction artistique est exploitable : mode sombre, palette, états et références visuelles.
- Flutter/React Native et Supabase/Firebase sont des pistes plausibles, avec authentification et notifications identifiées.

## Risques et décisions à prendre avant la production

| Priorité | Constat | Décision / action recommandée |
|---|---|---|
| **P0** | « Publication automatique multi-réseaux » n’est pas uniforme. Les API, permissions, types de compte, formats et validations diffèrent selon la plateforme. | Définir une matrice réseau × format × type de compte × action possible. Distinguer publication directe et rappel manuel. Valider les accès développeur et règles API avant de promettre l’automatisation. |
| **P0** | L’authentification est contradictoire : « email + mot de passe » dans la carte des modules, puis « uniquement une adresse e-mail » et OTP dans le détail. | Pour cette version, le choix retenu est **e-mail + mot de passe via Supabase Auth**, avec confirmation et récupération configurables. |
| **P0** | L’isolation des espaces est décrite comme « hermétique », sans modèle de données précis. | Un espace personnel est créé à l’inscription. Le modèle comporte des rôles et des politiques RLS, mais l’isolation doit être vérifiée avec au moins deux utilisateurs et plusieurs workspaces avant déploiement public. |
| **P0** | Jetons OAuth et médias sont sensibles ; stockage, consentements et cycle de vie doivent être validés. | Les refresh tokens YouTube sont chiffrés côté serveur (AES-GCM) dans les fonctions Edge. Ne jamais exposer une clé service-role ou le secret OAuth Google dans le navigateur. Ajouter révocation, audit, protection des secrets et procédures de rotation. |
| **P0** | YouTube peut refuser l’accès ou imposer des limites de quota, consentement et vérification. | Configurer Google Cloud, activer YouTube Data API v3, ajouter les URI exactes, tester un canal et traiter explicitement les refus / jetons expirés / quotas. |
| **P1** | Les autres réseaux n’ont pas encore d’intégration réelle dans cette livraison. | Instagram, Facebook, TikTok et Pinterest restent des publications planifiées/rappels ; ne pas afficher leur statut comme connecté ou publié. Réaliser chaque intégration séparément. |
| **P1** | « Suppression automatique » peut désigner le média, une publication planifiée ou un post déjà publié. | Séparer l’expiration d’un contenu planifié de la suppression d’un post déjà en ligne. Exiger confirmation/politique d’archivage et expliciter les limites API. |
| **P1** | Upload HD/4K sans politique opérationnelle détaillée. | Préciser taille, durée, codecs, ratio, reprise, stockage, coûts et suppression. Tester les quotas vidéo sur appareils Android réels. |
| **P1** | Aucun critère NFR complet n’est fourni (sécurité, disponibilité, accessibilité, performance, budget). | Fixer disponibilité, latence, accessibilité, appareils Android minimum, sauvegarde et observabilité. Ajouter des scénarios d’erreur et critères d’acceptation. |
| **P2** | Les visuels mettent en avant une expérience cinématique et un calendrier riche, sans exigences d’accessibilité détaillées. | Réduire les animations selon les préférences système, vérifier contraste, zones tactiles et navigation clavier/lecteur d’écran. |

## Livrable actuel

Le prototype web responsive est désormais doté d’un **socle PWA installable**, d’une interface de connexion e-mail/mot de passe, de la synchronisation des publications avec Supabase et d’un flux d’autorisation YouTube. Le schéma SQL, les règles RLS, les fonctions Edge et les instructions de configuration sont dans le dossier `supabase/` et `README-CONNECTED.md`.

Le mode démo local reste immédiatement testable. Tant que `config.js` et les secrets hébergés ne sont pas renseignés, aucune authentification réelle ni connexion à une chaîne ne peut fonctionner. Les publications YouTube peuvent être téléversées/programmées après configuration complète ; les autres réseaux demeurent des rappels de calendrier. La mise en production requiert un déploiement HTTPS, l’exécution des migrations, les secrets OAuth et les tests d’acceptation.

## Scénarios de recette

- Sans configuration, ouvrir le mode démo, créer une publication, puis la mettre en pause, la reprendre et la supprimer.
- Configurer un projet Supabase de test : créer un compte, confirmer l’e-mail, se déconnecter/reconnecter et récupérer le mot de passe.
- Vérifier que les publications reviennent après une reconnexion et qu’un autre utilisateur ne peut ni les lire ni les modifier (RLS).
- Lier une chaîne YouTube de test, vérifier le nom de la chaîne et programmer une vidéo future ; contrôler le statut privé et l’heure planifiée dans YouTube Studio.
- Tester erreurs OAuth : annulation, state expiré, révocation du refresh token, quotas, transfert interrompu et vidéo trop volumineuse.
- Installer la PWA sur Android via HTTPS et vérifier le shell hors-ligne, les transitions et la navigation tactile.
