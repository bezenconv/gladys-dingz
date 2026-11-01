# dingz

Intégration **non officielle** des interrupteurs connectés [dingz](https://www.dingz.ch) (iolo AG) pour Gladys Assistant. Elle pilote les dingz par leur **API REST locale** : rien ne passe par le cloud.

## Ce qui est pris en charge

Chaque dingz devient **un appareil** dans Gladys, avec les fonctionnalités qui correspondent à son câblage :

| Sur le dingz                         | Dans Gladys                                        |
| ------------------------------------ | -------------------------------------------------- |
| Sortie lumière                       | Lumière marche/arrêt                               |
| Sortie lumière variable              | Lumière marche/arrêt + luminosité (%)              |
| Autre sortie (prise, ventilateur...) | Interrupteur marche/arrêt                          |
| Moteur (store, volet)                | Ouvrir / fermer / stop, position (%), lamelles (%) |
| Capteur de température               | Température (°C)                                   |
| Capteur de luminosité                | Luminosité (lux)                                   |
| Détecteur de mouvement (front PIR)   | Mouvement                                          |
| Mesure par sortie                    | Puissance (W)                                      |

Les noms viennent de la configuration du dingz (nom du dingz, de la pièce, des sorties et des stores). Pour les stores, 0 % = fermé et 100 % = ouvert.

## Installation

1. Donnez à chaque dingz une **adresse IP fixe** dans votre routeur (recommandé).
2. Installez l'intégration, puis ouvrez **Configuration**.
3. Laissez **Découverte automatique (UDP)** activée : les dingz annoncent leur présence sur le port UDP 7979. Si vos dingz sont sur un autre réseau ou VLAN que Gladys, saisissez plutôt leurs adresses dans **Adresses des dingz** (séparées par des virgules).
4. Cliquez sur **Rechercher et tester les dingz** : le résultat liste les dingz joignables.
5. Dans l'onglet **Découverte**, ajoutez les dingz souhaités et placez-les dans une pièce.

## Réglages

- **Intervalle de rafraîchissement** : les dingz sont lus toutes les 5 secondes par défaut. C'est le délai avant que Gladys voie un bouton pressé à la main ou un mouvement. Après une commande envoyée depuis Gladys, le dingz est relu immédiatement, puis toutes les 2 secondes tant qu'un store bouge.
- **Identifier un dingz** : fait clignoter la LED frontale en rouge, puis la remet dans son état d'origine.

## Bon à savoir

- L'API REST doit être active sur le dingz (c'est le cas par défaut). La découverte UDP s'active dans l'application web du dingz, sous **Settings > Services**.
- Si un dingz change d'adresse IP, l'intégration relance une recherche automatiquement (au plus toutes les 5 minutes).
- Les appuis sur les boutons du dingz ne sont pas transmis comme événements : seul le changement d'état des sorties est visible, au prochain rafraîchissement.
- Les dingz plus (DDI / DALI) et le thermostat ne sont pas encore pris en charge.

Ce connecteur n'est ni affilié à iolo AG ni soutenu par elle. dingz est une marque de iolo AG.
