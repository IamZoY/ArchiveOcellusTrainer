export const FULL_FIGHT_CSS = `
.fight-hud {
  position: absolute;
  top: 8px;
  left: 92px;
  padding: 6px 10px;
  background: rgba(16, 12, 8, 0.72);
  border: 1px solid #5a4a2e;
  border-radius: 2px;
  font-family: "OSRS", sans-serif;
  color: #ff981f;
  text-shadow: 1px 1px 0 black;
  pointer-events: none;
  min-width: 110px;
}

.fight-hud-phase {
  font-size: 18px;
}

.fight-hud-timer {
  font-size: 22px;
  color: #fff;
}

.fight-hud-tick {
  font-size: 14px;
  color: #c8b88a;
}

.fight-loading {
  position: absolute;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: "OSRS", sans-serif;
  font-size: 16pt;
  color: #ffff00;
  text-shadow: 1px 1px 0 black;
  pointer-events: none;
}

.fight-loading-bar {
  width: min(50%, 420px);
  height: 14px;
  background: #282828;
  border: 1px solid #ffff00;
}

.fight-loading-bar > div {
  height: 100%;
  background: #ffff00;
  transition: width 0.2s linear;
}

.fight-loading-note {
  font-size: 11pt;
  color: #c8b88a;
}

.fight-result {
  position: absolute;
  top: 30%;
  left: 50%;
  transform: translateX(-60%);
  padding: 18px 24px;
  background: rgba(30, 24, 16, 0.94);
  border: 2px solid #6b5b3e;
  font-family: "OSRS", sans-serif;
  color: #ff981f;
  text-align: center;
  text-shadow: 1px 1px 0 black;
  min-width: 300px;
}

.fixed_game_view .fight-result {
  top: calc(var(--game-view-top) + var(--game-view-height) / 2);
  left: calc(var(--game-view-left) + var(--game-view-width) / 2);
  transform: translate(-50%, -50%);
  box-sizing: border-box;
  min-width: 0;
  max-width: var(--game-view-width);
  max-height: var(--game-view-height);
  overflow: auto;
}

.fight-result h2 {
  margin: 0 0 8px;
  font-weight: normal;
  font-size: 28px;
}

.fight-result p {
  color: #fff;
  margin: 0 0 14px;
  font-size: 18px;
}

.fight-result-buttons {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.fight-result-follow {
  margin: 12px 0 0;
  font-size: 13px;
  color: #c8b88a;
}

.fight-result-follow a {
  color: #ff981f;
}

.guide-stack {
  position: absolute;
  top: 96px;
  left: 92px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
}

.mechanics-guide {
  max-width: 300px;
  padding: 6px 10px;
  background: rgba(16, 12, 8, 0.8);
  border: 1px solid #5a4a2e;
  border-radius: 2px;
  font-family: "OSRS", sans-serif;
  font-size: 13px;
  color: #c8b88a;
  text-shadow: 1px 1px 0 black;
}

.mechanics-guide ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mechanics-guide li + li {
  margin-top: 3px;
}

.mechanics-guide-when {
  display: inline-block;
  min-width: 28px;
  font-weight: bold;
}

.mechanics-guide-what {
  color: #fff;
}

.mechanics-guide-todo {
  padding-left: 28px;
  font-size: 12px;
}

.prayer-guide {
  max-width: 280px;
  padding: 6px 10px;
  background: rgba(16, 12, 8, 0.8);
  border: 2px solid #5a4a2e;
  border-radius: 2px;
  font-family: "OSRS", sans-serif;
  font-size: 14px;
  color: #c8b88a;
  text-shadow: 1px 1px 0 black;
  pointer-events: none;
}

.prayer-guide-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.prayer-guide-icon {
  width: 25px;
  height: 25px;
  image-rendering: pixelated;
}

.prayer-guide-prayer {
  font-size: 18px;
}

.prayer-guide-when {
  color: #fff;
}

.prayer-guide-why,
.prayer-guide-next,
.prayer-guide-caution {
  margin-top: 4px;
}

.prayer-guide-caution {
  color: #ff981f;
}

@media (max-width: 900px), (max-height: 600px) {
  .guide-stack {
    top: 56px;
  }

  .mechanics-guide {
    max-width: 200px;
    font-size: 10px;
  }

  .prayer-guide {
    max-width: 200px;
    padding: 2px 6px;
    font-size: 10px;
  }

  .prayer-guide-prayer {
    font-size: 12px;
  }

  .fight-hud {
    padding: 2px 6px;
    min-width: 0;
  }

  .fight-hud-phase,
  .fight-hud-tick {
    font-size: 10px;
  }

  .fight-hud-timer {
    font-size: 12px;
  }
}
`;
