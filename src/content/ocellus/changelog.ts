import type { Changelog } from "../../releases";

export const CHANGELOG: Changelog = [
  {
    version: "2026.10.31",
    notes: [
      "Train the fight together. Co-op in the side panel gives a six-letter code to pass to your friends; they type it in or open the link you send, everyone presses Ready, and the host starts. You all fight the one boss on the same timings, so a crack, a rift or an explosion falls on the same tick for everyone.",
      "You see each other walk, pray and take damage as it happens, each in their own gear with their health above them. Everyone picks their own tier, shown beside their name. The boss is on one of you at a time, marked in the Co-op list, and only that person takes its hits. If you die you keep watching whoever is still standing, as in game.",
    ],
  },
  {
    version: "2026.10.29",
    notes: [
      "Tick Fixed mode under Display for the classic fixed interface: the 765 by 503 frame, scaled to fit the window, with its minimap, orbs, tabs and side panel where the fixed client puts them. Chat sits in the frame's chatbox in black text, and the camera turns and zooms only from the game view, as in game.",
      "Phase 2's portal gaps follow the game's three set patterns, orange, red and green, in the game's order after a random first, and Phase 2 patterns in Learning aids numbers every wave's safe spot, 1 to 6, in its pattern's colour.",
      "In phase 3, the Void Rift, Void Siphon and Void Augmenter now play their spawn, despawn and detonate animations, and killing a Void Siphon heals you 22.",
      "Your bag now carries ranging potions instead of Bastion potions, and potion boosts wear off over time as in game, 1 level a minute.",
      "In phase 3, a sever blocks your protection prayers for one tick, as in game, so Protect from Melee clicked straight back on is up for the next saw, and \"Your panic... is futile...\" now warns of a Void Vine, not his magic shot. In phase 1, he walks out of the middle a tick later after his strike.",
    ],
  },
  {
    version: "2026.10.28",
    notes: [
      "Insolence's three waves now leave the damaging void field on every tile they hit, as in game.",
      "In the full fight's phase 3, you cross a chasm in four quick jumps, one a tick, from the bank onto each stepping stone and off the far one, as in game.",
      "About 1 run in 10 sends an anonymous performance summary, so we can find what causes lag. To turn it off, untick Performance data under About.",
      "The site opens straight into the full fight, starting at phase 4, with every phase in the Start at selector. The separate phase 4 drill page is gone.",
      "Settings is one panel: Fight, Learning aids, Sound, Controls, then About, which keeps What's new and the Performance data box. In Fight, Start with picks the weapon in your hand: the twisted bow (the default), the toxic blowpipe, or the scythe in melee gear, with the same inventory either way. Tick Defence drained to start each phase with his Defence as low as it goes.",
    ],
  },
  {
    version: "2026.10.27",
    notes: [
      "The full fight is in beta. Full fight (beta) on the drill page opens it, and the phase selector starts you in phase 1, 2, or 3.",
      "The credit line sits under the game, so it no longer covers the tabs on a phone.",
      "Chat stays above the inventory on a narrow screen, so the lines no longer cover it.",
    ],
  },
  {
    version: "2026.10.26.2",
    notes: [
      "Before each run of void explosions, a ring of dark ovals forms around your feet, as in game, three ticks before the first mark.",
      "Ocellus plays his death animation when you kill him, glows as he steals your lifeforce in the melee phase, and a gust blows back at you when Deflect turns your hit away. Your lifeforce orb plays a heal sound as it returns your HP.",
      "Explosions hit 14 to 16, a transition attack you pray against hits up to 10, and the inner orb stays one tick longer, as the recorded fights show.",
      "Void rifts come 2, 3, 4 and then 5 a cycle, on random tiles 2 to 5 from Ocellus, as in the recorded fights.",
    ],
  },
];
