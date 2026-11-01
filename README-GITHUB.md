# Jilact — interface web

Fichiers statiques prêts à la racine pour relier le dépôt à Vercel. Les Edge Functions YouTube sont déjà déployées dans Supabase ; elles ne sont pas remplacées par ce dépôt. `config.js` contient uniquement l’URL Supabase et la clé publishable destinée au navigateur. Ne jamais y ajouter de secret.

Le formulaire propose des hashtags contextuels (pas des tendances en direct). Les répétitions YouTube suivantes sont des validations manuelles ; elles ne re-téléversent pas automatiquement la vidéo.
