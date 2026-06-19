// ============================================================================
// hud.js — DOM HUD: build bar, abilities, wave/HP/gold, tower panel, screens.
// Renders state and forwards user intent to the Game.
// ============================================================================
import { TOWERS, TOWER_ORDER, ABILITIES, ABILITY_ORDER } from './config.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(game) {
    this.game = game;
    this.gold = 0;
    this.selectedTower = null;
    this._lastWave = 0;
    this._bannerTimeout = null;

    this._buildTowerButtons();
    this._buildAbilityButtons();
    this._wireControls();
  }

  _buildTowerButtons() {
    const bar = $('build-bar');
    this.towerBtns = {};
    for (const id of TOWER_ORDER) {
      const t = TOWERS[id];
      const b = document.createElement('button');
      b.className = 'build-btn';
      b.innerHTML =
        `<div class="swatch" style="background:${t.swatch}"></div>` +
        `<div class="bname">${t.emoji} ${t.name}</div>` +
        `<div class="bcost">${t.levels[0].cost}</div>`;
      b.title = t.desc;
      b.addEventListener('click', () => this.game.selectTowerType(id));
      bar.appendChild(b);
      this.towerBtns[id] = b;
    }
  }

  _buildAbilityButtons() {
    const bar = $('ability-bar');
    this.abilityBtns = {};
    for (const id of ABILITY_ORDER) {
      const a = ABILITIES[id];
      const el = document.createElement('button');
      el.className = 'ability';
      el.innerHTML = `<span class="em">${a.emoji}</span><span class="nm">${a.name}</span><div class="cd"></div>`;
      el.title = a.name;
      el.addEventListener('click', () => this.game.armAbility(id));
      bar.appendChild(el);
      this.abilityBtns[id] = el;
    }
  }

  _wireControls() {
    $('btn-start').addEventListener('click', () => this.game.onStartButton());
    $('btn-pause').addEventListener('click', () => this.game.setSpeed(0));
    $('btn-1x').addEventListener('click', () => this.game.setSpeed(1));
    $('btn-2x').addEventListener('click', () => this.game.setSpeed(2));
    $('btn-mute').addEventListener('click', () => this.game.toggleMute());
    $('btn-play').addEventListener('click', () => this.game.start());
    $('btn-restart').addEventListener('click', () => this.game.restart());
    $('btn-how').addEventListener('click', () => $('how').classList.toggle('hidden'));
  }

  // ---- Wave banner ----
  _showWaveBanner(waveNum, isBoss) {
    const banner = $('wave-banner');
    if (!banner) return;

    // Clear any running animation so it can restart
    banner.classList.remove('show', 'boss');
    // Force reflow to restart animation
    void banner.offsetWidth;

    $('wb-num').textContent = isBoss ? '⚠ BOSS WAVE' : `WAVE ${waveNum}`;
    $('wb-sub').textContent = isBoss ? 'Brace yourself — a Warlord approaches!' : 'Defend the castle!';

    if (isBoss) banner.classList.add('boss');
    banner.classList.add('show');

    clearTimeout(this._bannerTimeout);
    this._bannerTimeout = setTimeout(() => {
      banner.classList.remove('show', 'boss');
    }, 2800);
  }

  // ---- top bar ----
  setWave(n, total) {
    $('wave-num').textContent = n;
    $('wave-total').textContent = total;

    // Show banner whenever wave number increases (i.e., a new wave starts)
    if (n > this._lastWave && n > 0) {
      this._lastWave = n;
      // isBoss detection: waves 10 and 20
      const isBoss = (n === 10 || n === 20);
      this._showWaveBanner(n, isBoss);
    }
  }

  setWaveProgress(frac) { $('wave-bar-fill').style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`; }

  setWaveState(txt) {
    $('wave-state').textContent = txt;
    // Also catch boss state from game text if needed
    if (txt && /boss/i.test(txt) && this._lastWave > 0) {
      // Already handled in setWave; no-op here
    }
  }

  setCastle(hp, max) {
    $('hp-fill').style.width = `${Math.max(0, hp / max) * 100}%`;
    $('hp-text').textContent = `${Math.max(0, Math.ceil(hp))} / ${max}`;

    // Pulse the heart when HP is low (below 30%)
    const panel = $('castle-hp-panel');
    if (panel) panel.classList.toggle('low', hp / max < 0.30);
  }

  setGold(g) {
    this.gold = g;
    $('gold').textContent = Math.floor(g);
    this._refreshAffordable();
  }

  _refreshAffordable() {
    for (const id of TOWER_ORDER) {
      const cost = TOWERS[id].levels[0].cost;
      this.towerBtns[id].classList.toggle('cant', this.gold < cost);
    }
    if (this._panelTower) this._refreshPanelButtons();
  }

  // ---- start / speed / mute ----
  setStartButton(visible, label) {
    const b = $('btn-start');
    b.style.display = visible ? '' : 'none';
    if (label) b.textContent = label;
  }
  setSpeed(n) {
    $('btn-pause').classList.toggle('active', n === 0);
    $('btn-1x').classList.toggle('active', n === 1);
    $('btn-2x').classList.toggle('active', n === 2);
  }
  setMute(m) { $('btn-mute').textContent = m ? '🔇' : '🔊'; }

  // ---- selection highlight ----
  selectTower(id) {
    this.selectedTower = id;
    for (const k of TOWER_ORDER) this.towerBtns[k].classList.toggle('selected', k === id);
  }
  armAbility(id) {
    for (const k of ABILITY_ORDER) this.abilityBtns[k].classList.toggle('armed', k === id);
  }
  setAbilityCooldown(id, frac, disabled) {
    const el = this.abilityBtns[id];
    el.querySelector('.cd').style.setProperty('--cd', `${frac * 360}deg`);
    el.classList.toggle('disabled', disabled);
  }

  // ---- tower panel ----
  showTowerPanel(tower) {
    this._panelTower = tower;
    const p = $('tower-panel');
    p.classList.remove('hidden');
    const s = tower.stats;
    const lvl = tower.level + 1;
    const slow = s.slow ? `${Math.round(s.slow.amount * 100)}% / ${s.slow.duration}s` : '—';
    p.innerHTML =
      `<h3>${tower.def.emoji} ${tower.def.name} <span class="lvl">Lv ${lvl}/3</span></h3>` +
      `<div class="stats">` +
      `<span>Damage</span><b>${s.damage}</b>` +
      `<span>Fire rate</span><b>${s.fireRate.toFixed(2)}/s</b>` +
      `<span>Range</span><b>${s.range.toFixed(1)}</b>` +
      `<span>Splash</span><b>${s.splash ? s.splash.toFixed(1) : '—'}</b>` +
      `<span>Slow</span><b>${slow}</b>` +
      `<span>DPS</span><b>${Math.round(s.damage * s.fireRate)}</b>` +
      `</div><div class="row">` +
      `<button class="btn" id="tp-up"></button>` +
      `<button class="btn danger" id="tp-sell"></button>` +
      `</div>`;
    $('tp-up').addEventListener('click', () => this.game.upgradeSelected());
    $('tp-sell').addEventListener('click', () => this.game.sellSelected());
    this._refreshPanelButtons();
  }

  _refreshPanelButtons() {
    const t = this._panelTower;
    if (!t) return;
    const up = $('tp-up'), sell = $('tp-sell');
    if (!up || !sell) return;
    if (t.canUpgrade()) {
      const c = t.upgradeCost();
      up.textContent = `▲ Upgrade (${c})`;
      up.disabled = this.gold < c;
    } else {
      up.textContent = 'Max level';
      up.disabled = true;
    }
    sell.textContent = `Sell (+${t.sellValue()})`;
  }

  hideTowerPanel() {
    this._panelTower = null;
    $('tower-panel').classList.add('hidden');
  }

  // ---- transient messages ----
  toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('show'), 1600);
  }
  hint(msg) {
    const el = $('hint');
    if (msg) { el.textContent = msg; el.classList.add('show'); }
    else el.classList.remove('show');
  }

  // ---- screens ----
  loading(frac, text) {
    $('load-fill').style.width = `${frac * 100}%`;
    if (text) $('load-text').textContent = text;
  }
  hideLoading() { $('loading').classList.add('hidden'); }
  showStart() { $('start-screen').classList.remove('hidden'); }
  hideStart() { $('start-screen').classList.add('hidden'); }

  showEnd(win, statsHtml, stars) {
    const s = $('end-screen');
    s.classList.remove('hidden');

    // Title & crest
    const title = $('end-title');
    title.textContent = win ? 'VICTORY' : 'DEFEAT';
    title.className = 'title ' + (win ? 'victory' : 'defeat');

    const crest = $('end-crest');
    if (crest) crest.textContent = win ? '🏆' : '💀';

    // Stars with staggered pop-in animation
    const starsEl = $('stars');
    const filledCount = win ? Math.max(0, Math.min(3, stars)) : 0;
    let starsHtml = '';
    for (let i = 0; i < 3; i++) {
      if (i < filledCount) {
        starsHtml += `<span class="star" style="animation-delay:${0.2 + i * 0.18}s">★</span>`;
      } else {
        starsHtml += `<span class="star off">★</span>`;
      }
    }
    starsEl.innerHTML = starsHtml;

    $('end-stats').innerHTML = statsHtml;
  }
  hideEnd() { $('end-screen').classList.add('hidden'); }
}
