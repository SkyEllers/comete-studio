# Payloads Calendly de recette

Cinq messages, recopiés sur la forme documentée par Calendly — **y compris les
champs que Radar n'utilise pas** : `name`, `timezone`, `cancel_url`,
`text_reminder_number`, `routing_form_submission`…

Ils sont là exprès, et pour deux raisons.

La première : ils éprouvent le dosage du schéma zod. Strict sur l'enveloppe,
tolérant sur le `payload` — un message réel porte une vingtaine de champs, et
les refuser en bloc ferait perdre des rendez-vous en silence.

La seconde : `payload.name` vaut « Camille Dupont », avec `first_name` et
`last_name` à `null`. Depuis la phase 7, c'est le repli de la décision 8 qui
est éprouvé là — le découpage du nom complet au premier espace — et le contrôle
du banc s'est inversé sur ce point précis : le nom **doit** se retrouver sur la
ligne du rendez-vous, et **nulle part ailleurs**. Ni dans le journal, ni dans
les activités, ni dans les relevés, qui eux sont conservés sans limite.

L'email, lui, ne doit toujours apparaître nulle part, sous aucune forme. C'est
le contrat de Radar avec les données personnelles, et c'est un contrat qui se
prouve, pas qui se promet.

Le jour où un client aura un formulaire Calendly en deux champs, un sixième
payload avec `first_name` et `last_name` renseignés viendra éprouver l'autre
branche.

Les gabarits `{{EMAIL}}`, `{{INVITEE_URI}}`, `{{EVENT_URI}}`, `{{START}}`,
`{{END}}` et `{{OLD_INVITEE}}` sont remplacés par `scripts/qa-radar.mjs`.

**À vérifier sur un vrai payload du premier client avant la mise en
production** : la forme exacte de `payload.payment` et de `payload.tracking`.
Notamment si Calendly renvoie ou non `gclid` et `fbclid` dans `tracking` — s'il
ne les renvoie pas, le script de la landing (chantier 6) devra les loger dans
`utm_content` ou `utm_term`.
