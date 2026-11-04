# Jilact connecté — configuration de lancement

Cette livraison ajoute au prototype une base de **PWA Android installable**, un socle Supabase (Auth + données + stockage privé), les migrations SQL et une intégration YouTube sécurisée côté serveur. Les identifiants réels ne sont pas présents : le mode démo continue donc de fonctionner jusqu’à la configuration du projet.

## 1. Supabase

1. Crée un projet Supabase et garde son URL ainsi que la clé **publishable/anon**.
2. Dans SQL Editor, exécute `supabase/migrations/20261030_initial.sql`.
3. Dans Authentication → Providers, active Email + Password et choisis si la confirmation par e-mail est obligatoire.
4. Configure l’URL du site et les URL de redirection Auth vers le domaine HTTPS de l’application.
5. Dans `config.js`, renseigne uniquement `supabaseUrl` et `supabaseAnonKey`.
6. Avec Supabase CLI lié au projet, exécute `supabase db push` puis déploie les quatre Edge Functions :
   `supabase functions deploy youtube-oauth-start`, `youtube-oauth-callback`, `youtube-token` et `youtube-account-status`.

**Ne mets jamais** la clé `service_role`, le secret OAuth Google ou la clé de chiffrement dans `config.js`, le navigateur, Git ou un message public.

## 2. YouTube

1. Dans Google Cloud Console, active **YouTube Data API v3**, configure l’écran de consentement OAuth et crée un client OAuth Web.
2. Ajoute comme URI de redirection exacte : `https://<PROJECT_REF>.supabase.co/functions/v1/youtube-oauth-callback`.
3. Configure les secrets Supabase des Edge Functions :

```sh
supabase secrets set GOOGLE_CLIENT_ID="..." \
  GOOGLE_CLIENT_SECRET="..." \
  APP_ORIGIN="https://votre-domaine.example" \
  YOUTUBE_TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"
```

Les fonctions utilisent aussi les variables Supabase standard `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` fournies à l’environnement Edge. Vérifie leur présence avant déploiement. La clé AES doit être sauvegardée en lieu sûr : perdre cette clé impose de reconnecter les comptes YouTube.

Le consentement Google peut nécessiter un mode test, des comptes de test autorisés et/ou une vérification Google avant toute diffusion publique. Une connexion ne contourne pas les limites de l’API ni les règles de publication YouTube.

## 3. PWA / Android

Héberge le dossier sur HTTPS. Ouvre le site dans Chrome Android puis « Installer l’application » / « Ajouter à l’écran d’accueil ». `manifest.webmanifest` et `sw.js` gèrent l’installation et la mise en cache du shell. En développement, un navigateur moderne et un serveur HTTP local suffisent.

## 4. Ce qui est maintenant branché dans l’interface

- Auth Supabase e-mail/mot de passe : inscription, connexion, déconnexion, récupération par e-mail et confirmation si activée dans Supabase.
- Chargement, ajout, pause/reprise et suppression des publications dans la base avec l’espace personnel. Les erreurs côté client sont signalées.
- OAuth YouTube depuis Paramètres, retour vers l’application, état de compte et import d’une vidéo via l’API YouTube ; les vidéos futures sont envoyées en privé avec `publishAt` pour la planification YouTube. La chaîne doit autoriser ce flux et disposer des quotas/API requis.
- Les tokens de rafraîchissement sont chiffrés AES-GCM par une Edge Function ; le navigateur ne reçoit qu’un access token à durée courte et limité au scope demandé.
- PWA : manifest, icône, service worker. Le mode démo local reste disponible tant que Supabase n’est pas configuré.
- Les publications destinées aux réseaux autres que YouTube restent des rappels/éléments de calendrier ; aucune publication Meta/TikTok/Pinterest n’est simulée comme réussie.

Cette intégration est implémentée, mais **non activée tant que le projet Supabase, les secrets Google et les domaines HTTPS ne sont pas configurés**. Il faut tester les politiques RLS, OAuth, téléversements et quota sur un compte de test avant de la traiter comme production.

## Contrôles avant mise en production

- Remplacer l’origine CORS de démonstration par l’origine HTTPS exacte, configurer CSP et limites de débit.
- Tester la création de compte, confirmation, mot de passe oublié, sessions et révocation.
- Tester RLS avec deux utilisateurs et des espaces distincts ; aucune clé service-role côté client.
- Tester l’OAuth Google en mode test, état expiré/réutilisé, refresh token révoqué et scopes minimaux.
- Vérifier les limites de durée/taille vidéo, formats, publication privée/programmée et erreurs quota/consentement.
- Ajouter politique de confidentialité, suppression/export des données, journaux d’audit, sauvegardes et monitoring.

## Éditeur de contenu et séries récurrentes (version suivante)

Avant de déployer la nouvelle version, exécutez une fois le fichier `supabase/migrations/20261101_content_series.sql` dans Supabase Dashboard → SQL Editor → New query → Run. Cette migration ajoute les variantes de texte par réseau et les métadonnées de série.

Le formulaire possède maintenant un éditeur par réseau : YouTube demande un titre, une description et des hashtags ; les autres réseaux ont leurs propres champs de légende/titre/description. Les suggestions de hashtags sont contextuelles et générées dans l’application ; elles ne mesurent pas les tendances en direct et ne garantissent pas la viralité.

Une série permet de définir N publications au total (2 à 30), une date de début et une date de fin, et un ou plusieurs créneaux : matin (06–12 h), après-midi (12–18 h), soirée (18–23 h) ou nuit (23–06 h). Les dates sont réparties aussi régulièrement que possible et les heures varient dans les créneaux sélectionnés. L’aperçu montre les dates/heures exactes avant validation.

Pour une série YouTube, Jilact téléverse et programme uniquement la première occurrence. Les suivantes apparaissent dans le calendrier comme actions à valider, sans téléverser automatiquement le même fichier plusieurs fois. Instagram, TikTok, Facebook et Pinterest restent des rappels manuels tant que leurs intégrations ne sont pas réalisées. Les rappels listés dans le calendrier ne déclenchent pas encore de notifications push.
