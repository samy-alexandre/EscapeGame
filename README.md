# AURORA-7

Un escape game **coopératif multijoueur en temps réel**, jouable directement dans le navigateur (desktop & mobile). 2 à 4 joueurs, 20 minutes pour s'échapper d'une station spatiale en perdition.

> Sans téléchargement, sans compte, sans dépendance lourde. Juste un code de salle et un navigateur.

---

## 🎮 Le jeu

Vous vous réveillez à bord de la station **Aurora-7**, dérivant à travers le secteur 47. Trois salles vous séparent de la capsule de secours, et chacune cache une énigme **qu'aucun joueur ne peut résoudre seul** : la communication entre coéquipiers est la vraie mécanique.

### Les énigmes coopératives

1. **Décodage des sigles** — Un joueur voit une séquence de 4 symboles, l'autre a un pad à 8 touches. Il faut **dicter** dans le bon ordre.
2. **Stabilisation du réseau** — Un joueur voit la couleur cible. L'autre voit une grille 4×4 et 8 interrupteurs qui modifient chacun une ligne ou une colonne. Il faut **synchroniser** vos manipulations.
3. **Séquence de lancement** — Tous les joueurs doivent **maintenir** leur levier en même temps pendant 5 secondes.

Si le timer global de 20 minutes expire, l'oxygène s'épuise — partie perdue.

---

## 🛠️ Stack technique

| Couche       | Choix                                    |
|--------------|------------------------------------------|
| Backend      | Node.js 18+ · Express 4 · Socket.IO 4    |
| Frontend     | HTML5 · CSS3 (CSS variables, grid)       |
| Temps réel   | Socket.IO (WebSocket + fallback polling) |
| Audio        | Web Audio API (sons synthétisés)         |
| Persistance  | Mémoire serveur (pas de DB)              |

**Aucune dépendance lourde côté client.** Pas de framework, pas de bundler. Le client tient en quelques centaines de Ko, fonts comprises.

---

## 📂 Structure du projet

```
escape-aurora/
├── server.js                  # Express + Socket.IO, orchestrateur
├── package.json
├── Procfile                   # Render / Heroku
├── render.yaml                # Config Render (déploiement 1-clic)
├── README.md
├── .gitignore
├── src/
│   ├── game/
│   │   ├── GameRoom.js        # État d'une partie (joueurs, salles, timer)
│   │   └── Puzzles.js         # Logique serveur des 3 énigmes (autoritaire)
│   └── utils/
│       └── codeGenerator.js   # Codes de salle 4 caractères
└── public/                    # Servi par Express en statique
    ├── index.html
    ├── css/
    │   └── style.css
    ├── js/
    │   ├── audio.js           # Synthèse sonore (Web Audio)
    │   ├── network.js         # Wrapper Socket.IO + reconnexion
    │   ├── ui.js              # Écrans, lobby, chat, toasts
    │   ├── puzzles.js         # Rendu et interactions des énigmes
    │   └── main.js            # Point d'entrée, bindings
    └── assets/                # (vide — tout est généré ou inline)
```

---

## 🚀 Lancement local

### Prérequis

- **Node.js 18+** (testé sur 18, 20)
- npm (livré avec Node)

### Étapes

```bash
# 1. Cloner ou télécharger ce dossier
git clone https://github.com/<votre-pseudo>/escape-aurora.git
cd escape-aurora

# 2. Installer les dépendances (express + socket.io seulement)
npm install

# 3. Démarrer le serveur
npm start
```

Le serveur affiche :

```
Aurora-7 en orbite sur http://localhost:3000
```

Ouvrez `http://localhost:3000` dans **deux onglets** (ou deux appareils sur le même réseau), créez une salle dans le premier, rejoignez avec le code dans le second, et lancez la partie.

### Tester sur mobile en local

Si votre PC et votre téléphone sont sur le même Wi-Fi :

1. Récupérez l'IP locale du PC (`ipconfig` / `ifconfig`, par exemple `192.168.1.42`)
2. Sur le téléphone, ouvrez `http://192.168.1.42:3000`

---

## ☁️ Déploiement sur Render

### Méthode 1 — via `render.yaml` (recommandé)

1. Pushez le projet sur un dépôt GitHub.
2. Sur [render.com](https://render.com), cliquez **New +** → **Blueprint**.
3. Connectez votre dépôt. Render détecte `render.yaml` et crée le service automatiquement.
4. Attendez la fin du build (1–2 min). Votre URL publique apparaît : `https://escape-aurora.onrender.com`.

### Méthode 2 — service Web manuel

1. **New +** → **Web Service** → connectez votre repo GitHub.
2. Paramètres :
   - **Environment** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `node server.js`
   - **Plan** : Free (suffisant pour 4 joueurs)
   - **Health Check Path** : `/health`
3. **Create Web Service**.

> ⚠️ **Plan Free de Render** : le service se met en veille après 15 min d'inactivité (premier chargement ~30 s pour le réveil). Aucun souci pour jouer, à signaler à vos amis.

### Variables d'environnement

Aucune n'est requise. Le serveur utilise automatiquement `process.env.PORT` (fourni par Render) ou `3000` en local.

---

## 🧪 Tests d'intégration

Un test de bout en bout est fourni — il démarre le serveur, simule 2 joueurs, joue une partie complète (création de salle, 3 énigmes, victoire), teste la déconnexion/reconnexion, le chat, les validations serveur, et termine par 40 assertions :

```bash
npm test
```

Sortie attendue : `Tests : 40 réussis, 0 échoués`.

C'est aussi une bonne référence pour comprendre le flux du jeu.

---

## 🧩 Comment ajouter une énigme

L'architecture est pensée pour qu'ajouter un puzzle prenne ~50 lignes :

1. Dans `src/game/Puzzles.js`, ajoutez trois fonctions :
   - `createMyPuzzle(observerId)` → état initial
   - `viewMyPuzzle(puzzle, viewerId)` → vue filtrée par joueur (cache les solutions)
   - `applyMyAction(puzzle, action, playerId)` → applique une action, set `solved = true` quand résolu
2. Branchez-les dans les trois `switch` du bas du fichier.
3. Dans `src/game/GameRoom.js`, ajoutez votre salle dans `ROOMS_SEQUENCE`.
4. Dans `public/js/puzzles.js`, ajoutez un `mountMyPuzzle` + `updateMyPuzzle`, et un case dans `render()`.

C'est tout — le serveur s'occupe de diffuser l'état, le timer, la victoire/défaite.

---

## ⚙️ Caractéristiques techniques

- **Serveur autoritaire** : le client n'envoie que des actions, le serveur valide et diffuse l'état (impossible de tricher en bidouillant le client).
- **Snapshots filtrés** : chaque joueur reçoit uniquement les infos qu'il est censé voir (un joueur ne reçoit pas la solution d'un puzzle qu'il n'est pas censé observer).
- **Reconnexion automatique** : si un joueur perd la connexion, il peut revenir avec le même pseudo et reprendre exactement où il en était. Son slot est conservé.
- **Migration d'hôte** : si l'hôte se déconnecte, le rôle passe automatiquement à un autre joueur.
- **Heartbeat** : ping client toutes les 8 s en plus du ping natif Socket.IO (détection rapide des coupures).
- **Cleanup** : les salles vides depuis plus de 10 min sont supprimées automatiquement.
- **Validation côté serveur** : pseudos sanitisés, codes de salle normalisés, actions vérifiées.

---

## 📜 Licence

MIT — faites-en ce que vous voulez.
